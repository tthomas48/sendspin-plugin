'use strict';

const { spawn } = require('child_process');
const { Readable, Writable } = require('stream');

/**
 * Audio Decoder Module
 * Decodes audio from Sendspin-supported formats (Opus, FLAC, PCM) to PCM
 * 
 * Supports multiple decoding methods:
 * - Native libraries (opus-encdec) - best performance
 * - Command-line tools (ffmpeg, flac) - fallback option
 */
class AudioDecoder {
  constructor(config = {}) {
    this.config = {
      codec: config.codec || 'opus', // 'opus', 'flac', 'pcm'
      sampleRate: config.sampleRate || 48000,
      channels: config.channels || 2,
      bitDepth: config.bitDepth || 16,
      decodingMethod: config.decodingMethod || 'auto', // 'auto', 'native', 'command-line'
      ...config
    };
    
    this.logger = config.logger || console;
    this.decoder = null;
    this.isInitialized = false;
    this.decodingProcess = null;
    this.currentStreamFormat = null;
  }

  /**
   * Initialize decoder
   */
  async initialize(format) {
    if (this.isInitialized && this.currentStreamFormat === format) {
      return;
    }

    // Update format
    this.currentStreamFormat = format;
    this.config.codec = format.codec || this.config.codec;
    this.config.sampleRate = format.sample_rate || this.config.sampleRate;
    this.config.channels = format.channels || this.config.channels;
    this.config.bitDepth = format.bit_depth || this.config.bitDepth;

    switch (this.config.codec) {
      case 'opus':
        await this.initializeOpus();
        break;
      case 'flac':
        await this.initializeFLAC();
        break;
      case 'pcm':
        // PCM doesn't need decoding, just pass through
        this.isInitialized = true;
        break;
      default:
        throw new Error(`Unsupported codec: ${this.config.codec}`);
    }
  }

  /**
   * Initialize Opus decoder
   */
  async initializeOpus() {
    // Try native decoder first (opus-encdec from sendspin-js)
    try {
      const opusEncdec = require('./sendspin-js/dist/index.js');
      if (opusEncdec && opusEncdec.OpusDecoder) {
        this.decoder = new opusEncdec.OpusDecoder({
          sampleRate: this.config.sampleRate,
          channels: this.config.channels
        });
        this.isInitialized = true;
        this.logger.info('[AudioDecoder] Using native Opus decoder');
        return;
      }
    } catch (error) {
      this.logger.warn('[AudioDecoder] Native Opus decoder not available:', error.message);
    }

    // Fallback to ffmpeg
    try {
      this.decodingProcess = spawn('ffmpeg', [
        '-f', 'opus',
        '-i', 'pipe:0',
        '-f', 's16le',
        '-ar', String(this.config.sampleRate),
        '-ac', String(this.config.channels),
        'pipe:1'
      ], {
        stdio: ['pipe', 'pipe', 'ignore']
      });

      this.decodingProcess.on('error', (error) => {
        this.logger.error('[AudioDecoder] FFmpeg decoder error:', error);
      });

      this.isInitialized = true;
      this.logger.info('[AudioDecoder] Using FFmpeg for Opus decoding');
    } catch (error) {
      throw new Error(`Failed to initialize Opus decoder: ${error.message}`);
    }
  }

  /**
   * Initialize FLAC decoder
   */
  async initializeFLAC() {
    // Use flac command-line tool
    try {
      this.decodingProcess = spawn('flac', [
        '-d', // decode
        '-c', // output to stdout
        '-f', // force overwrite
        '-' // read from stdin
      ], {
        stdio: ['pipe', 'pipe', 'ignore']
      });

      this.decodingProcess.on('error', (error) => {
        this.logger.error('[AudioDecoder] FLAC decoder error:', error);
      });

      this.isInitialized = true;
      this.logger.info('[AudioDecoder] Using FLAC command-line decoder');
    } catch (error) {
      throw new Error(`Failed to initialize FLAC decoder: ${error.message}`);
    }
  }

  /**
   * Decode audio data
   * @param {Buffer|ArrayBuffer} encodedData - Encoded audio data
   * @returns {Promise<Buffer>} Decoded PCM audio data
   */
  async decode(encodedData) {
    if (!this.isInitialized) {
      throw new Error('Decoder not initialized');
    }

    // PCM pass-through
    if (this.config.codec === 'pcm') {
      return Buffer.isBuffer(encodedData) ? encodedData : Buffer.from(encodedData);
    }

    // Native decoder (Opus)
    if (this.decoder && typeof this.decoder.decode === 'function') {
      try {
        const decoded = this.decoder.decode(encodedData);
        return Buffer.isBuffer(decoded) ? decoded : Buffer.from(decoded);
      } catch (error) {
        this.logger.error('[AudioDecoder] Native decode error:', error);
        throw error;
      }
    }

    // Command-line decoder (FFmpeg or FLAC)
    // Note: For streaming, we need to keep the process alive
    // This implementation creates a new process for each chunk (not ideal but works)
    // For better performance, use native decoder when available
    if (this.decodingProcess) {
      // For streaming, we should use a persistent decoder
      // But for simplicity, we'll spawn a new process for each chunk
      // TODO: Implement persistent streaming decoder for better performance
      return new Promise((resolve, reject) => {
        const { spawn } = require('child_process');
        let decoderProcess;
        
        if (this.config.codec === 'opus') {
          decoderProcess = spawn('ffmpeg', [
            '-f', 'opus',
            '-i', 'pipe:0',
            '-f', 's16le',
            '-ar', String(this.config.sampleRate),
            '-ac', String(this.config.channels),
            'pipe:1'
          ], {
            stdio: ['pipe', 'pipe', 'ignore']
          });
        } else if (this.config.codec === 'flac') {
          decoderProcess = spawn('flac', [
            '-d', // decode
            '-c', // output to stdout
            '-f', // force overwrite
            '-' // read from stdin
          ], {
            stdio: ['pipe', 'pipe', 'ignore']
          });
        } else {
          reject(new Error(`Unsupported codec for command-line decoder: ${this.config.codec}`));
          return;
        }

        const chunks = [];
        
        decoderProcess.stdout.on('data', (chunk) => {
          chunks.push(chunk);
        });

        decoderProcess.stdout.on('end', () => {
          resolve(Buffer.concat(chunks));
        });

        decoderProcess.on('error', (error) => {
          reject(error);
        });

        decoderProcess.stdout.on('error', (error) => {
          reject(error);
        });

        // Write encoded data to decoder
        const data = Buffer.isBuffer(encodedData) ? encodedData : Buffer.from(encodedData);
        decoderProcess.stdin.write(data);
        decoderProcess.stdin.end();
      });
    }

    throw new Error('No decoder available');
  }

  /**
   * Cleanup decoder resources
   */
  cleanup() {
    if (this.decodingProcess) {
      this.decodingProcess.kill();
      this.decodingProcess = null;
    }
    if (this.decoder && typeof this.decoder.destroy === 'function') {
      this.decoder.destroy();
    }
    this.isInitialized = false;
    this.currentStreamFormat = null;
  }
}

module.exports = AudioDecoder;

