'use strict';

const http = require('http');
const { Readable } = require('stream');

/**
 * Audio Player Module
 * Plays decoded PCM audio through Volumio's MPD (Music Player Daemon)
 * 
 * Uses HTTP streaming approach:
 * 1. Creates an HTTP server that streams PCM audio
 * 2. Adds the HTTP stream URL to MPD's queue via Volumio's commandRouter
 * 3. Feeds decoded audio chunks to the HTTP stream
 */
class AudioPlayer {
  constructor(config = {}) {
    this.config = {
      sampleRate: config.sampleRate || 48000,
      channels: config.channels || 2,
      bitDepth: config.bitDepth || 16,
      streamPort: config.streamPort || 0, // 0 = auto-assign
      ...config
    };
    
    this.logger = config.logger || console;
    this.commandRouter = config.commandRouter || null;
    
    // HTTP stream server
    this.httpServer = null;
    this.streamPort = null;
    this.streamUrl = null;
    
    // Audio stream
    this.audioStream = null;
    this.isPlaying = false;
    this.currentClient = null; // MPD client connection
  }

  /**
   * Start audio playback
   * Creates HTTP stream server and adds stream to MPD queue
   */
  async start(format) {
    if (this.isPlaying) {
      this.logger.warn('[AudioPlayer] Already playing');
      return;
    }

    // Update format
    this.config.sampleRate = format.sample_rate || this.config.sampleRate;
    this.config.channels = format.channels || this.config.channels;
    this.config.bitDepth = format.bit_depth || this.config.bitDepth;

    try {
      // Create HTTP stream server
      await this.createStreamServer();
      
      // Add stream to MPD queue
      await this.addToMPDQueue();
      
      this.isPlaying = true;
      this.logger.info(`[AudioPlayer] Started playback via MPD on ${this.streamUrl}`);
    } catch (error) {
      this.logger.error('[AudioPlayer] Failed to start playback:', error);
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Create HTTP stream server for PCM audio
   */
  async createStreamServer() {
    return new Promise((resolve, reject) => {
      // Create readable stream for audio data
      this.audioStream = new Readable({
        read() {
          // Push data as it arrives via play() method
        }
      });

      // Create HTTP server
      this.httpServer = http.createServer((req, res) => {
        // Only handle GET requests to /stream
        if (req.method !== 'GET' || req.url !== '/stream') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }

        // Set headers for audio stream
        // MPD expects raw PCM, but we'll use audio/x-wav or audio/pcm
        // Some MPD versions prefer audio/x-wav even for raw PCM
        res.writeHead(200, {
          'Content-Type': 'audio/x-wav', // MPD-compatible content type
          'Content-Transfer-Encoding': 'binary',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Accept-Ranges': 'none'
        });

        // Pipe audio stream to response
        this.audioStream.pipe(res);

        // Handle client disconnect
        req.on('close', () => {
          this.logger.info('[AudioPlayer] Stream client disconnected');
          this.currentClient = null;
          // Unpipe if still connected
          if (this.audioStream && res.writable) {
            this.audioStream.unpipe(res);
          }
        });

        req.on('error', (error) => {
          this.logger.warn('[AudioPlayer] Stream client error:', error);
          this.currentClient = null;
        });

        this.currentClient = res;
        this.logger.info('[AudioPlayer] Stream client connected');
      });

      // Find available port
      const port = this.config.streamPort || 0; // 0 = auto-assign
      this.httpServer.listen(port, '127.0.0.1', () => {
        const address = this.httpServer.address();
        this.streamPort = address.port;
        this.streamUrl = `http://127.0.0.1:${this.streamPort}/stream`;
        this.logger.info(`[AudioPlayer] HTTP stream server listening on ${this.streamUrl}`);
        resolve();
      });

      this.httpServer.on('error', (error) => {
        this.logger.error('[AudioPlayer] HTTP server error:', error);
        reject(error);
      });
    });
  }

  /**
   * Add HTTP stream to MPD queue using Volumio's commandRouter
   */
  async addToMPDQueue() {
    if (!this.commandRouter) {
      throw new Error('commandRouter not available');
    }

    if (!this.streamUrl) {
      throw new Error('Stream URL not available');
    }

    try {
      // Create track metadata for MPD
      const track = {
        uri: this.streamUrl,
        service: 'sendspin',
        name: 'Sendspin Stream',
        title: 'Sendspin Stream',
        artist: 'Sendspin',
        album: 'Live Stream',
        type: 'webradio',
        trackType: 'pcm',
        samplerate: String(this.config.sampleRate),
        bitdepth: String(this.config.bitDepth),
        channels: String(this.config.channels)
      };

      // Try multiple approaches to add stream to MPD
      // Method 1: volumioAddToQueue (most common)
      if (this.commandRouter.volumioAddToQueue) {
        await this.commandRouter.volumioAddToQueue(track);
        this.logger.info('[AudioPlayer] Added stream to MPD via volumioAddToQueue');
        return;
      }

      // Method 2: volumioReplaceAndPlay
      if (this.commandRouter.volumioReplaceAndPlay) {
        await this.commandRouter.volumioReplaceAndPlay(track);
        this.logger.info('[AudioPlayer] Added stream to MPD via volumioReplaceAndPlay');
        return;
      }

      // Method 3: volumioPlay
      if (this.commandRouter.volumioPlay) {
        await this.commandRouter.volumioPlay(track);
        this.logger.info('[AudioPlayer] Added stream to MPD via volumioPlay');
        return;
      }

      // Method 4: Use HTTP API directly (fallback)
      const http = require('http');
      const postData = JSON.stringify(track);
      const options = {
        hostname: '127.0.0.1',
        port: 3000, // Default Volumio API port
        path: '/api/v1/addToQueue',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            this.logger.info('[AudioPlayer] Added stream to MPD via HTTP API');
            resolve();
          } else {
            this.logger.warn(`[AudioPlayer] HTTP API returned status ${res.statusCode}`);
            // Don't reject - stream is still available
            resolve();
          }
        });

        req.on('error', (error) => {
          this.logger.warn('[AudioPlayer] HTTP API request failed:', error.message);
          // Don't reject - stream is still available
          resolve();
        });

        req.write(postData);
        req.end();
      });
    } catch (error) {
      this.logger.error('[AudioPlayer] Failed to add stream to MPD:', error);
      // Don't throw - stream server is still running, user can manually add
      this.logger.warn('[AudioPlayer] Stream is still available at:', this.streamUrl);
    }
  }

  /**
   * Play PCM audio data
   * Feeds audio chunks to the HTTP stream
   * @param {Buffer} pcmData - PCM audio data to play
   */
  async play(pcmData) {
    if (!this.isPlaying || !this.audioStream) {
      return;
    }

    try {
      // Push data to the readable stream
      // This will be piped to the HTTP response
      if (!this.audioStream.push(pcmData)) {
        // Stream is backpressured, wait a bit
        await new Promise((resolve) => {
          this.audioStream.once('drain', resolve);
        });
      }
    } catch (error) {
      this.logger.error('[AudioPlayer] Error playing audio:', error);
      throw error;
    }
  }

  /**
   * Stop audio playback
   */
  async stop() {
    if (!this.isPlaying) {
      return;
    }

    try {
      // Stop MPD playback if possible
      if (this.commandRouter && this.commandRouter.volumioStop) {
        try {
          await this.commandRouter.volumioStop();
        } catch (error) {
          // Ignore errors when stopping
        }
      }

      // End the audio stream
      if (this.audioStream) {
        this.audioStream.push(null); // Signal end of stream
        this.audioStream = null;
      }

      // Close HTTP server
      if (this.httpServer) {
        await new Promise((resolve) => {
          this.httpServer.close(() => {
            resolve();
          });
        });
        this.httpServer = null;
      }

      this.streamUrl = null;
      this.streamPort = null;
      this.currentClient = null;
      this.isPlaying = false;
      this.logger.info('[AudioPlayer] Stopped playback');
    } catch (error) {
      this.logger.error('[AudioPlayer] Error stopping playback:', error);
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    await this.stop();
  }

  /**
   * Check if currently playing
   */
  isActive() {
    return this.isPlaying;
  }

  /**
   * Get stream URL (for manual MPD configuration if needed)
   */
  getStreamUrl() {
    return this.streamUrl;
  }
}

module.exports = AudioPlayer;
