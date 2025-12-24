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
      // Ensure volume is set before starting playback
      await this.ensureVolume();
      
      // Create HTTP stream server
      await this.createStreamServer();
      this.logger.info('[AudioPlayer] Stream server created, setting isPlaying=true');
      this.isPlaying = true; // Set early so chunks can be buffered even if MPD hasn't connected yet
      
      // Add stream to MPD queue (don't wait for MPD to connect - it will connect when it's ready)
      this.addToMPDQueue().catch((error) => {
        this.logger.error('[AudioPlayer] Failed to add stream to MPD queue (non-fatal):', error);
        // Don't throw - stream server is running, MPD can connect manually if needed
      });
      
      this.logger.info(`[AudioPlayer] Started playback via MPD on ${this.streamUrl} (isPlaying=${this.isPlaying})`);
    } catch (error) {
      this.logger.error('[AudioPlayer] Failed to start playback:', error);
      this.isPlaying = false;
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Ensure volume is set and not muted before playback
   */
  async ensureVolume() {
    if (!this.commandRouter) {
      this.logger.warn('[AudioPlayer] No commandRouter, cannot check/set volume');
      return;
    }

    try {
      // Get current state to check volume
      if (this.commandRouter.volumioGetState) {
        const state = await this.commandRouter.volumioGetState();
        const currentVolume = state.volume || 0;
        const currentMute = state.mute || false;
        
        this.logger.info(`[AudioPlayer] Current Volumio state: volume=${currentVolume}, mute=${currentMute}`);
        
        // If muted, unmute
        if (currentMute && this.commandRouter.volumioUnmute) {
          this.logger.info('[AudioPlayer] Unmuting Volumio...');
          await this.commandRouter.volumioUnmute();
        }
        
        // If volume is 0, set to a reasonable level (50%)
        if (currentVolume === 0) {
          this.logger.warn('[AudioPlayer] Volume is 0! Setting to 50%...');
          if (this.commandRouter.volumioSetVolume) {
            await this.commandRouter.volumioSetVolume(50);
          } else if (this.commandRouter.volumioSetVolume && typeof this.commandRouter.volumioSetVolume === 'function') {
            // Try alternative method
            await this.commandRouter.volumioSetVolume({ volume: 50 });
          }
        }
      }
    } catch (error) {
      this.logger.warn('[AudioPlayer] Failed to check/set volume:', error.message);
      // Don't throw - continue with playback
    }
  }

  /**
   * Create WAV header for PCM audio
   * For streaming, we use 0xFFFFFFFF to indicate unknown size
   * @returns {Buffer} WAV header buffer
   */
  createWAVHeader() {
    const sampleRate = this.config.sampleRate;
    const channels = this.config.channels;
    const bitDepth = this.config.bitDepth;
    const byteRate = sampleRate * channels * (bitDepth / 8);
    const blockAlign = channels * (bitDepth / 8);
    // For streaming WAV, use 0xFFFFFFFF for both file size and data size (unknown/streaming)
    const dataSize = 0xFFFFFFFF;
    const fileSize = 0xFFFFFFFF; // Also use 0xFFFFFFFF for file size in streaming mode
    
    const header = Buffer.allocUnsafe(44);
    let offset = 0;
    
    // RIFF header
    header.write('RIFF', offset); offset += 4;
    header.writeUInt32LE(fileSize, offset); offset += 4;
    header.write('WAVE', offset); offset += 4;
    
    // fmt chunk
    header.write('fmt ', offset); offset += 4;
    header.writeUInt32LE(16, offset); offset += 4; // fmt chunk size (16 for PCM)
    header.writeUInt16LE(1, offset); offset += 2; // audio format (1 = PCM)
    header.writeUInt16LE(channels, offset); offset += 2;
    header.writeUInt32LE(sampleRate, offset); offset += 4;
    header.writeUInt32LE(byteRate, offset); offset += 4;
    header.writeUInt16LE(blockAlign, offset); offset += 2;
    header.writeUInt16LE(bitDepth, offset); offset += 2;
    
    // data chunk
    header.write('data', offset); offset += 4;
    header.writeUInt32LE(dataSize, offset); offset += 4;
    
    return header;
  }

  /**
   * Create HTTP stream server for PCM audio
   */
  async createStreamServer() {
    return new Promise((resolve, reject) => {
      // Track if we've sent the WAV header
      this.wavHeaderSent = false;
      
      // Create readable stream for audio data
      this.audioStream = new Readable({
        read() {
          // Push data as it arrives via play() method
        }
      });
      
      // Increase max listeners to avoid warnings when handling backpressure
      // This is safe because we use 'once' which removes listeners after they fire
      this.audioStream.setMaxListeners(20);

      // Create HTTP server
      this.httpServer = http.createServer((req, res) => {
        this.logger.info(`[AudioPlayer] HTTP request: ${req.method} ${req.url} from ${req.socket.remoteAddress}`);
        
        // Only handle GET requests to /stream
        if (req.method !== 'GET' || req.url !== '/stream') {
          this.logger.warn(`[AudioPlayer] Rejected request: ${req.method} ${req.url}`);
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }
        
        this.logger.info('[AudioPlayer] MPD connected to stream');

        // Set headers for audio stream
        res.writeHead(200, {
          'Content-Type': 'audio/wav', // WAV format with headers
          'Content-Transfer-Encoding': 'binary',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Accept-Ranges': 'none'
        });

        // Send WAV header first, then pipe audio stream
        const wavHeader = this.createWAVHeader();
        this.logger.info(`[AudioPlayer] Sending WAV header: ${this.config.sampleRate}Hz, ${this.config.channels}ch, ${this.config.bitDepth}bit (${wavHeader.length} bytes)`);
        
        // Write header directly to response
        if (!res.write(wavHeader)) {
          this.logger.warn('[AudioPlayer] Response backpressured while writing WAV header');
        }
        
        this.wavHeaderSent = true;

        // Pipe audio stream to response (after header)
        this.audioStream.pipe(res, { end: false }); // Don't end response when stream ends
        
        this.logger.info('[AudioPlayer] Audio stream piped to MPD response');

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
    this.logger.info(`[AudioPlayer] addToMPDQueue called: commandRouter=${!!this.commandRouter}, streamUrl=${this.streamUrl}`);
    
    if (!this.commandRouter) {
      this.logger.error('[AudioPlayer] commandRouter not available!');
      throw new Error('commandRouter not available');
    }

    if (!this.streamUrl) {
      this.logger.error('[AudioPlayer] Stream URL not available!');
      throw new Error('Stream URL not available');
    }

    try {
      // Create track metadata for MPD
      // Use 'webradio' service so it uses webradio plugin's clearAddPlayTrack method
      const track = {
        uri: this.streamUrl,
        service: 'webradio', // Must be 'webradio' to use webradio plugin's clearAddPlayTrack
        name: 'Sendspin Stream',
        title: 'Sendspin Stream',
        artist: 'Sendspin',
        album: 'Live Stream',
        type: 'webradio'
      };

      this.logger.info(`[AudioPlayer] Attempting to add stream to MPD: ${this.streamUrl}`);
      this.logger.info(`[AudioPlayer] Track metadata: ${JSON.stringify(track)}`);
      this.logger.info(`[AudioPlayer] Available methods: executeOnPlugin=${!!this.commandRouter.executeOnPlugin}, replaceAndPlay=${!!this.commandRouter.replaceAndPlay}`);

      // Call webradio plugin's clearAddPlayTrack directly to bypass URI explosion
      // This avoids the addQueueItems -> explodeUri path that fails for HTTP URLs
      if (this.commandRouter.executeOnPlugin) {
        this.logger.info('[AudioPlayer] Calling webradio plugin clearAddPlayTrack directly...');
        try {
          await this.commandRouter.executeOnPlugin('music_service', 'webradio', 'clearAddPlayTrack', track);
          this.logger.info('[AudioPlayer] Added stream to MPD via webradio clearAddPlayTrack');
          return;
        } catch (error) {
          this.logger.error('[AudioPlayer] webradio clearAddPlayTrack failed:', error);
          // Continue to fallback
        }
      }

      // Fallback: Use replaceAndPlay (but it will try to explode URI first, which may fail)
      if (this.commandRouter.replaceAndPlay) {
        this.logger.info('[AudioPlayer] Trying replaceAndPlay (may fail URI explosion)...');
        try {
          // Use simple format with just uri
          await this.commandRouter.replaceAndPlay({ uri: this.streamUrl });
          this.logger.info('[AudioPlayer] Added stream to MPD via replaceAndPlay');
          return;
        } catch (error) {
          this.logger.error('[AudioPlayer] replaceAndPlay failed:', error);
          // Continue to HTTP API fallback
        }
      }
      
      this.logger.warn('[AudioPlayer] commandRouter methods not available, using HTTP API fallback...');

      // Method 4: Use HTTP API directly to add to queue, then play
      const http = require('http');
      
      // First, add to queue
      const addToQueueData = JSON.stringify(track);
      const addOptions = {
        hostname: '127.0.0.1',
        port: 3000, // Default Volumio API port
        path: '/api/v1/addToQueue',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(addToQueueData)
        }
      };

      return new Promise((resolve, reject) => {
        const addReq = http.request(addOptions, (res) => {
          let responseData = '';
          res.on('data', (chunk) => { responseData += chunk; });
          res.on('end', () => {
            if (res.statusCode === 200 || res.statusCode === 201) {
              this.logger.info(`[AudioPlayer] Added stream to MPD queue via HTTP API (status ${res.statusCode})`);
              
              // Now try to play
              const playOptions = {
                hostname: '127.0.0.1',
                port: 3000,
                path: '/api/v1/commands/?cmd=play',
                method: 'GET'
              };
              
              const playReq = http.request(playOptions, (playRes) => {
                if (playRes.statusCode === 200) {
                  this.logger.info('[AudioPlayer] Started playback via HTTP API');
                } else {
                  this.logger.warn(`[AudioPlayer] Play command returned status ${playRes.statusCode}`);
                }
                resolve();
              });
              
              playReq.on('error', (error) => {
                this.logger.warn('[AudioPlayer] Play command failed:', error.message);
                resolve(); // Don't reject - stream is in queue
              });
              
              playReq.end();
            } else {
              this.logger.warn(`[AudioPlayer] HTTP API returned status ${res.statusCode}, response: ${responseData}`);
              // Don't reject - stream is still available
              resolve();
            }
          });
        });

        addReq.on('error', (error) => {
          this.logger.warn('[AudioPlayer] HTTP API request failed:', error.message);
          // Don't reject - stream is still available
          resolve();
        });

        addReq.write(addToQueueData);
        addReq.end();
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
    if (!this.audioStream) {
      this.logger.warn(`[AudioPlayer] Cannot play: audioStream not initialized`);
      return;
    }
    
    // If not playing (paused), still buffer data but don't warn
    // MPD will handle pausing, but we want to keep buffering for smooth resume
    if (!this.isPlaying) {
      // Log occasionally to diagnose why playback stopped
      if (!this._notPlayingWarningCount) this._notPlayingWarningCount = 0;
      this._notPlayingWarningCount++;
      if (this._notPlayingWarningCount <= 5 || this._notPlayingWarningCount % 100 === 0) {
        this.logger.warn(`[AudioPlayer] Cannot play: isPlaying=false (warning #${this._notPlayingWarningCount}). Audio player may need to be restarted.`);
      }
      return;
    }

    // Warn if no client is connected (MPD hasn't connected yet)
    if (!this.currentClient) {
      // Only log this occasionally to avoid spam
      if (!this._noClientWarningCount) this._noClientWarningCount = 0;
      this._noClientWarningCount++;
      if (this._noClientWarningCount <= 5 || this._noClientWarningCount % 100 === 0) {
        this.logger.warn(`[AudioPlayer] No MPD client connected! Chunk will be buffered. (warning #${this._noClientWarningCount})`);
      }
    }

    try {
      // Push data to the readable stream
      // This will be piped to the HTTP response
      const pushed = this.audioStream.push(pcmData);
      
      // Log first few chunks and then periodically
      if (!this._playCount) this._playCount = 0;
      this._playCount++;
      if (this._playCount <= 10 || this._playCount % 100 === 0) {
        this.logger.info(`[AudioPlayer] Pushed chunk #${this._playCount}: ${pcmData.length} bytes, backpressured=${!pushed}, hasClient=${!!this.currentClient}, isPlaying=${this.isPlaying}`);
      }
      
      if (!pushed) {
        // Stream is backpressured, wait for drain
        // Use a shorter timeout for slow machines - if we can't drain quickly, skip this chunk
        // This prevents the queue from building up indefinitely
        this.logger.debug('[AudioPlayer] Stream backpressured, waiting for drain');
        try {
          await Promise.race([
            new Promise((resolve) => {
              this.audioStream.once('drain', resolve);
            }),
            new Promise((resolve) => {
              setTimeout(() => {
                // On slow machines, if drain takes too long, the chunk is likely too late anyway
                // Log but don't throw - let the scheduler handle late chunks
                this.logger.debug('[AudioPlayer] Drain timeout - stream may be slow, continuing');
                resolve();
              }, 100); // 100ms timeout - if we can't drain in 100ms, machine is too slow
            })
          ]);
        } catch (error) {
          // Ignore errors - chunk will be dropped by scheduler if too late
          this.logger.debug('[AudioPlayer] Drain wait error (ignored):', error.message);
        }
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
   * Clear audio stream buffer (for seek/stream clear)
   * Resets the stream buffer but keeps playback active
   */
  clearBuffer() {
    if (!this.audioStream) {
      this.logger.warn('[AudioPlayer] Cannot clear buffer: audioStream not initialized');
      return;
    }
    
    // Create a new stream to replace the old one
    // This clears any buffered data
    const oldStream = this.audioStream;
    this.audioStream = new Readable({
      objectMode: false,
      read() {
        // Stream will be fed by play() method
      }
    });
    
    // If there's an active client, re-pipe the new stream
    if (this.currentClient && oldStream) {
      try {
        oldStream.unpipe(this.currentClient);
        // Send WAV header again for the new stream
        const wavHeader = this.createWAVHeader();
        if (!this.currentClient.write(wavHeader)) {
          this.logger.warn('[AudioPlayer] Response backpressured while writing WAV header after clear');
        }
        this.audioStream.pipe(this.currentClient, { end: false });
        this.wavHeaderSent = true;
        this.logger.info('[AudioPlayer] Stream buffer cleared and re-piped to client');
      } catch (error) {
        this.logger.error('[AudioPlayer] Error re-piping stream after clear:', error);
      }
    } else {
      this.logger.info('[AudioPlayer] Stream buffer cleared (no active client - will reconnect)');
      this.wavHeaderSent = false; // Reset so header is sent when client reconnects
    }
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
