'use strict';

/**
 * Test helpers and utilities
 */

/**
 * Create a mock logger
 */
function createMockLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };
}

/**
 * Create mock PCM audio data
 */
function createMockPCMData(samples = 1024, channels = 2, bitDepth = 16) {
  const bytesPerSample = bitDepth / 8;
  const size = samples * channels * bytesPerSample;
  return Buffer.alloc(size, 0);
}

/**
 * Wait for a promise to resolve or timeout
 */
function waitFor(promise, timeout = 5000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeout)
    )
  ]);
}

/**
 * Mock SendspinClient for testing
 */
function createMockSendspinClient() {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    sendMessage: jest.fn(),
    isConnected: false,
    currentStreamFormat: null,
    config: {
      onStreamStart: null,
      onStreamEnd: null,
      onAudioChunk: null
    }
  };
}

/**
 * Mock AudioDecoder for testing
 */
function createMockAudioDecoder() {
  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    decode: jest.fn().mockResolvedValue(Buffer.from([1, 2, 3, 4])),
    cleanup: jest.fn()
  };
}

/**
 * Mock AudioPlayer for testing
 */
function createMockAudioPlayer() {
  return {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    play: jest.fn().mockResolvedValue(undefined),
    isActive: jest.fn().mockReturnValue(false),
    getStreamUrl: jest.fn().mockReturnValue('http://localhost:3000/stream')
  };
}

module.exports = {
  createMockLogger,
  createMockPCMData,
  waitFor,
  createMockSendspinClient,
  createMockAudioDecoder,
  createMockAudioPlayer
};

