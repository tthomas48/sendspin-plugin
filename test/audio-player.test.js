'use strict';

const AudioPlayer = require('../lib/audio-player');
const http = require('http');

// Mock http
jest.mock('http');

describe('AudioPlayer', () => {
  let player;
  let mockLogger;
  let mockCommandRouter;
  let mockHttpServer;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockCommandRouter = {
      volumioAddToQueue: jest.fn().mockResolvedValue(undefined),
      volumioReplaceAndPlay: jest.fn().mockResolvedValue(undefined),
      volumioPlay: jest.fn().mockResolvedValue(undefined),
      volumioStop: jest.fn().mockResolvedValue(undefined)
    };

    // Mock HTTP server
    mockHttpServer = {
      listen: jest.fn((port, host, callback) => {
        if (callback) callback();
        return mockHttpServer;
      }),
      close: jest.fn((callback) => {
        if (callback) callback();
      }),
      address: jest.fn().mockReturnValue({ port: 3000 })
    };

    http.createServer.mockReturnValue(mockHttpServer);
  });

  afterEach(async () => {
    if (player && player.isActive()) {
      await player.stop();
    }
    jest.clearAllTimers();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      player = new AudioPlayer({
        commandRouter: mockCommandRouter,
        logger: mockLogger
      });
      
      expect(player.config.sampleRate).toBe(48000);
      expect(player.config.channels).toBe(2);
      expect(player.config.bitDepth).toBe(16);
      expect(player.isPlaying).toBe(false);
    });

    it('should accept custom config', () => {
      player = new AudioPlayer({
        sampleRate: 44100,
        channels: 1,
        bitDepth: 24,
        commandRouter: mockCommandRouter,
        logger: mockLogger
      });
      
      expect(player.config.sampleRate).toBe(44100);
      expect(player.config.channels).toBe(1);
      expect(player.config.bitDepth).toBe(24);
    });
  });

  describe('start', () => {
    it('should create HTTP stream server', async () => {
      player = new AudioPlayer({
        commandRouter: mockCommandRouter,
        logger: mockLogger
      });

      await player.start({
        codec: 'pcm',
        sample_rate: 48000,
        channels: 2,
        bit_depth: 16
      });

      expect(http.createServer).toHaveBeenCalled();
      expect(mockHttpServer.listen).toHaveBeenCalled();
      expect(player.isPlaying).toBe(true);
      expect(player.streamUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/stream$/);
    });

    it('should add stream to MPD queue', async () => {
      player = new AudioPlayer({
        commandRouter: mockCommandRouter,
        logger: mockLogger
      });

      await player.start({
        codec: 'pcm',
        sample_rate: 48000,
        channels: 2,
        bit_depth: 16
      });

      // Wait a bit for async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockCommandRouter.volumioAddToQueue).toHaveBeenCalled();
    });

    it('should not start if already playing', async () => {
      player = new AudioPlayer({
        commandRouter: mockCommandRouter,
        logger: mockLogger
      });

      await player.start({
        codec: 'pcm',
        sample_rate: 48000,
        channels: 2,
        bit_depth: 16
      });

      const firstUrl = player.streamUrl;
      await player.start({
        codec: 'pcm',
        sample_rate: 48000,
        channels: 2,
        bit_depth: 16
      });

      expect(mockLogger.warn).toHaveBeenCalledWith('[AudioPlayer] Already playing');
      expect(player.streamUrl).toBe(firstUrl);
    });
  });

  describe('play', () => {
    beforeEach(async () => {
      player = new AudioPlayer({
        commandRouter: mockCommandRouter,
        logger: mockLogger
      });

      await player.start({
        codec: 'pcm',
        sample_rate: 48000,
        channels: 2,
        bit_depth: 16
      });
    });

    it('should push audio data to stream', async () => {
      const audioData = Buffer.from([1, 2, 3, 4]);
      
      // Mock the audio stream
      const mockStream = {
        push: jest.fn().mockReturnValue(true),
        pipe: jest.fn(),
        on: jest.fn()
      };
      player.audioStream = mockStream;

      await player.play(audioData);

      expect(mockStream.push).toHaveBeenCalledWith(audioData);
    });

    it('should not play if not active', async () => {
      player.isPlaying = false;
      const audioData = Buffer.from([1, 2, 3, 4]);

      await player.play(audioData);

      // Should not throw, just return early
      expect(player.audioStream).toBeDefined();
    });
  });

  describe('stop', () => {
    beforeEach(async () => {
      player = new AudioPlayer({
        commandRouter: mockCommandRouter,
        logger: mockLogger
      });

      await player.start({
        codec: 'pcm',
        sample_rate: 48000,
        channels: 2,
        bit_depth: 16
      });
    });

    it('should stop MPD playback and close server', async () => {
      await player.stop();

      expect(mockCommandRouter.volumioStop).toHaveBeenCalled();
      expect(mockHttpServer.close).toHaveBeenCalled();
      expect(player.isPlaying).toBe(false);
      expect(player.streamUrl).toBeNull();
    });

    it('should handle stop when not playing', async () => {
      player.isPlaying = false;
      await expect(player.stop()).resolves.not.toThrow();
    });
  });

  describe('isActive', () => {
    it('should return false when not playing', () => {
      player = new AudioPlayer({
        commandRouter: mockCommandRouter,
        logger: mockLogger
      });

      expect(player.isActive()).toBe(false);
    });

    it('should return true when playing', async () => {
      player = new AudioPlayer({
        commandRouter: mockCommandRouter,
        logger: mockLogger
      });

      await player.start({
        codec: 'pcm',
        sample_rate: 48000,
        channels: 2,
        bit_depth: 16
      });

      expect(player.isActive()).toBe(true);
    });
  });
});



