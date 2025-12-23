'use strict';

const AudioDecoder = require('../lib/audio-decoder');
const { spawn } = require('child_process');

// Mock child_process
jest.mock('child_process');

describe('AudioDecoder', () => {
  let decoder;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
  });

  afterEach(() => {
    if (decoder) {
      decoder.cleanup();
      decoder = null;
    }
    jest.clearAllTimers();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      decoder = new AudioDecoder({ logger: mockLogger });
      
      expect(decoder.config.codec).toBe('opus');
      expect(decoder.config.sampleRate).toBe(48000);
      expect(decoder.config.channels).toBe(2);
      expect(decoder.config.bitDepth).toBe(16);
    });

    it('should accept custom config', () => {
      decoder = new AudioDecoder({
        codec: 'flac',
        sampleRate: 44100,
        channels: 1,
        bitDepth: 24,
        logger: mockLogger
      });
      
      expect(decoder.config.codec).toBe('flac');
      expect(decoder.config.sampleRate).toBe(44100);
      expect(decoder.config.channels).toBe(1);
      expect(decoder.config.bitDepth).toBe(24);
    });
  });

  describe('initialize', () => {
    it('should initialize PCM decoder (pass-through)', async () => {
      decoder = new AudioDecoder({
        codec: 'pcm',
        logger: mockLogger
      });

      await decoder.initialize({
        codec: 'pcm',
        sample_rate: 48000,
        channels: 2,
        bit_depth: 16
      });

      expect(decoder.isInitialized).toBe(true);
      expect(decoder.currentStreamFormat).toEqual({
        codec: 'pcm',
        sample_rate: 48000,
        channels: 2,
        bit_depth: 16
      });
    });

    it('should not reinitialize if format unchanged', async () => {
      decoder = new AudioDecoder({
        codec: 'pcm',
        logger: mockLogger
      });

      const format = {
        codec: 'pcm',
        sample_rate: 48000,
        channels: 2,
        bit_depth: 16
      };

      await decoder.initialize(format);
      expect(decoder.isInitialized).toBe(true);
      
      // Initialize again with same format - should not change
      await decoder.initialize(format);
      
      expect(decoder.isInitialized).toBe(true);
      expect(decoder.currentStreamFormat).toEqual(format);
    });
  });

  describe('decode', () => {
    it('should pass through PCM data', async () => {
      decoder = new AudioDecoder({
        codec: 'pcm',
        logger: mockLogger
      });

      await decoder.initialize({
        codec: 'pcm',
        sample_rate: 48000,
        channels: 2,
        bit_depth: 16
      });

      const inputData = Buffer.from([1, 2, 3, 4]);
      const decoded = await decoder.decode(inputData);

      expect(Buffer.isBuffer(decoded)).toBe(true);
      expect(decoded).toEqual(inputData);
    });

    it('should handle ArrayBuffer input for PCM', async () => {
      decoder = new AudioDecoder({
        codec: 'pcm',
        logger: mockLogger
      });

      await decoder.initialize({
        codec: 'pcm',
        sample_rate: 48000,
        channels: 2,
        bit_depth: 16
      });

      const inputData = new Uint8Array([1, 2, 3, 4]);
      const decoded = await decoder.decode(inputData.buffer);

      expect(Buffer.isBuffer(decoded)).toBe(true);
      expect(decoded).toEqual(Buffer.from(inputData));
    });

    it('should throw if not initialized', async () => {
      decoder = new AudioDecoder({
        codec: 'opus',
        logger: mockLogger
      });

      await expect(decoder.decode(Buffer.from([1, 2, 3]))).rejects.toThrow('Decoder not initialized');
    });
  });

  describe('cleanup', () => {
    it('should cleanup resources', () => {
      decoder = new AudioDecoder({
        codec: 'pcm',
        logger: mockLogger
      });
      decoder.isInitialized = true;
      decoder.currentStreamFormat = { codec: 'pcm' };

      decoder.cleanup();

      expect(decoder.isInitialized).toBe(false);
      expect(decoder.currentStreamFormat).toBeNull();
    });
  });
});

