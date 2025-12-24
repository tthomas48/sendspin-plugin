'use strict';

const { spawn } = require('child_process');

/**
 * Audio Decoder Module
 * Decodes audio from Sendspin-supported formats (Opus, FLAC, PCM) to PCM
 * 
 * Supports:
 * - WASM Opus decoder (opus-decoder) - primary method
 * - Native Opus decoder (sendspin-js) - fallback
 * - FLAC command-line tool - for FLAC decoding
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
    this.decodingProcess = null; // For FLAC only
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
    // Try WASM Opus decoder (opus-decoder from wasm-audio-decoders)
    // Note: opus-decoder is an ES Module, so we must use dynamic import()
    try {
      const { OpusDecoder } = await import('opus-decoder');
      this.decoder = new OpusDecoder({
        sampleRate: this.config.sampleRate,
        channels: this.config.channels
      });
      
      // Wait for WASM to be ready if needed (some decoders have async initialization)
      if (this.decoder.ready) {
        await this.decoder.ready;
      }
      
      this.isInitialized = true;
      this.logger.info(`[AudioDecoder] Using WASM Opus decoder (opus-decoder). Decoder type: ${typeof this.decoder}, has decode: ${typeof this.decoder.decode}, sampleRate: ${this.config.sampleRate}, channels: ${this.config.channels}`);
      return;
    } catch (error) {
      this.logger.error('[AudioDecoder] WASM Opus decoder initialization failed:', error);
      this.logger.error('[AudioDecoder] Error details:', error.stack);
      throw new Error(`Failed to initialize WASM Opus decoder: ${error.message}`);
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
      this.logger.error(`[AudioDecoder] Decode called but decoder not initialized. isInitialized=${this.isInitialized}, decoder=${!!this.decoder}, codec=${this.config.codec}`);
      throw new Error('Decoder not initialized');
    }

    // PCM pass-through
    if (this.config.codec === 'pcm') {
      return Buffer.isBuffer(encodedData) ? encodedData : Buffer.from(encodedData);
    }

    // WASM decoder (Opus)
    // opus-decoder uses decodeFrame() method, not decode()
    if (this.decoder) {
      try {
        let result;
        
        // opus-decoder uses decodeFrame() for single frames
        if (typeof this.decoder.decodeFrame === 'function') {
          result = this.decoder.decodeFrame(encodedData);
          if (result instanceof Promise) {
            result = await result;
          }
        } else if (typeof this.decoder.decode === 'function') {
          // Fallback to decode if it exists
          result = this.decoder.decode(encodedData);
          if (result instanceof Promise) {
            result = await result;
          }
        } else {
          throw new Error(`Decoder has no decode method. Available methods: ${Object.keys(this.decoder).filter(k => typeof this.decoder[k] === 'function').join(', ')}`);
        }
        
        // Handle WASM decoder format (opus-decoder): {channelData: Float32Array[], samplesDecoded: number}
        if (result && result.channelData && Array.isArray(result.channelData)) {
          const samplesDecoded = result.samplesDecoded;
          const channels = result.channelData.length;
          const pcm16 = Buffer.allocUnsafe(samplesDecoded * channels * 2); // 16-bit = 2 bytes per sample
          
          // Convert Float32Array to interleaved PCM16
          for (let i = 0; i < samplesDecoded; i++) {
            for (let ch = 0; ch < channels; ch++) {
              const sample = Math.max(-1, Math.min(1, result.channelData[ch][i])); // Clamp to [-1, 1]
              const int16 = Math.round(sample * 32767);
              const offset = (i * channels + ch) * 2;
              pcm16.writeInt16LE(int16, offset);
            }
          }
          
          return pcm16;
        } else {
          throw new Error(`Unexpected decoder output format: ${typeof result}, has channelData: ${!!(result && result.channelData)}, result keys: ${result ? Object.keys(result).join(', ') : 'null'}`);
        }
      } catch (error) {
        this.logger.error('[AudioDecoder] Decode error:', error);
        this.logger.error('[AudioDecoder] Decode error details:', error.stack);
        throw error;
      }
    }

    // Log detailed state for debugging
    this.logger.error(`[AudioDecoder] No decoder available! State: isInitialized=${this.isInitialized}, decoder=${!!this.decoder}, decoderType=${typeof this.decoder}, hasDecode=${!!(this.decoder && this.decoder.decode)}, codec=${this.config.codec}`);
    if (this.decoder) {
      this.logger.error(`[AudioDecoder] Decoder object keys: ${Object.keys(this.decoder).join(', ')}`);
    }
    throw new Error('No decoder available - decoder not initialized or decode method not found');
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
    
    if (this.decoder && typeof this.decoder.free === 'function') {
      this.decoder.free();
    }
    
    this.isInitialized = false;
    this.currentStreamFormat = null;
  }
}

module.exports = AudioDecoder;

