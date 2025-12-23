'use strict';

// Mock dependencies
jest.mock('../lib/sendspin-client');
jest.mock('../lib/audio-decoder');
jest.mock('../lib/audio-player');
jest.mock('v-conf');
jest.mock('os', () => ({
  hostname: jest.fn(() => 'test-device')
}));

const ControllerSendspin = require('../lib/index');
const SendspinClient = require('../lib/sendspin-client');
const AudioDecoder = require('../lib/audio-decoder');
const AudioPlayer = require('../lib/audio-player');
const vconf = require('v-conf');

describe('Sendspin Plugin Integration (Client Mode)', () => {
  let controller;
  let mockContext;
  let mockClient;
  let mockDecoder;
  let mockPlayer;
  let mockConfig;

  beforeEach(async () => {
    // Create mock config object
    mockConfig = {
      get: jest.fn((key) => {
        const defaults = {
          enabled: true
        };
        return defaults[key];
      }),
      set: jest.fn(),
      loadFile: jest.fn()
    };

    // Create mock client
    // disconnect() is an alias for stop(), so make it call stop()
    mockClient = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      isConnected: false,
      actualPort: 8080,
      currentStreamFormat: null,
      config: {
        onStreamStart: null,
        onStreamEnd: null,
        onAudioChunk: null,
        onStateChange: null
      }
    };
    
    // Make disconnect() an alias for stop() (returns the same promise)
    mockClient.disconnect = jest.fn(() => {
      return mockClient.stop();
    });

    // Create mock decoder
    mockDecoder = {
      initialize: jest.fn().mockResolvedValue(undefined),
      decode: jest.fn().mockResolvedValue(Buffer.from([1, 2, 3, 4])),
      cleanup: jest.fn()
    };

    // Create mock player
    mockPlayer = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      play: jest.fn().mockResolvedValue(undefined),
      isActive: jest.fn().mockReturnValue(false)
    };

    // Mock module constructors
    // For SendspinClient, we need to capture the config passed to it
    SendspinClient.mockImplementation((config) => {
      // Store the callbacks from config into mockClient.config
      if (config.onStreamStart) {
        mockClient.config.onStreamStart = config.onStreamStart;
      }
      if (config.onStreamEnd) {
        mockClient.config.onStreamEnd = config.onStreamEnd;
      }
      if (config.onAudioChunk) {
        mockClient.config.onAudioChunk = config.onAudioChunk;
      }
      if (config.onStateChange) {
        mockClient.config.onStateChange = config.onStateChange;
      }
      return mockClient;
    });
    AudioDecoder.mockImplementation(() => mockDecoder);
    AudioPlayer.mockImplementation(() => mockPlayer);

    // Mock v-conf - it's a constructor function
    vconf.mockImplementation(function() {
      // Return an object with the mock methods
      return {
        get: mockConfig.get,
        set: mockConfig.set,
        loadFile: mockConfig.loadFile
      };
    });

    mockContext = {
      coreCommand: {
        pluginManager: {
          getConfigurationFile: jest.fn().mockReturnValue('/tmp/config.json')
        },
        servicePushState: jest.fn()
      },
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }
    };

    controller = new ControllerSendspin(mockContext);
    
    // Initialize config by calling onVolumioStart
    // This will create a v-conf instance and assign it to controller.config
    // onVolumioStart returns a kew promise
    const startPromise = controller.onVolumioStart();
    if (startPromise && startPromise.promise) {
      // It's a kew promise - convert to regular promise
      await new Promise((resolve, reject) => {
        startPromise.promise.then(resolve, reject);
      });
    } else if (startPromise && typeof startPromise.then === 'function') {
      await startPromise;
    }
    
    // Ensure config is set
    expect(controller.config).toBeDefined();
    expect(controller.config.get).toBeDefined();
  });

  afterEach(async () => {
    if (controller && controller.sendspinPlayer) {
      await controller.onStop();
    }
    jest.clearAllTimers();
  });

  describe('onStart', () => {
    it('should initialize SendspinClient', async () => {
      await controller.onStart();

      expect(SendspinClient).toHaveBeenCalled();
      expect(controller.sendspinPlayer).toBeDefined();
      expect(mockClient.start).toHaveBeenCalled();
    });

    it('should initialize AudioDecoder and AudioPlayer', async () => {
      await controller.onStart();

      expect(AudioDecoder).toHaveBeenCalled();
      expect(AudioPlayer).toHaveBeenCalled();
      expect(controller.audioDecoder).toBeDefined();
      expect(controller.audioPlayer).toBeDefined();
    });

    it('should configure client callbacks', async () => {
      await controller.onStart();

      // Verify callbacks are set
      expect(mockClient.config.onStreamStart).toBeDefined();
      expect(mockClient.config.onStreamEnd).toBeDefined();
      expect(mockClient.config.onAudioChunk).toBeDefined();
    });

    it('should not start if disabled', async () => {
      // Reset the mock to clear previous calls
      SendspinClient.mockClear();
      
      // Temporarily override the config get method to return disabled
      const originalGet = mockConfig.get;
      mockConfig.get.mockImplementation((key) => {
        if (key === 'enabled') return false;
        return undefined;
      });
      
      await controller.onStart();

      expect(SendspinClient).not.toHaveBeenCalled();
      
      // Restore original get implementation
      mockConfig.get.mockImplementation(originalGet);
    });

    it('should handle start errors', async () => {
      mockClient.start.mockRejectedValue(new Error('Start failed'));

      await expect(controller.onStart()).rejects.toThrow('Start failed');
    });
  });

  describe('onStop', () => {
    beforeEach(async () => {
      await controller.onStart();
    });

    it('should stop client', async () => {
      await controller.onStop();

      expect(mockClient.stop).toHaveBeenCalled();
      expect(controller.sendspinPlayer).toBeNull();
    });

    it('should stop audio playback', async () => {
      await controller.onStop();

      expect(mockPlayer.stop).toHaveBeenCalled();
      expect(mockDecoder.cleanup).toHaveBeenCalled();
    });

    it('should handle stop when not started', async () => {
      controller.sendspinPlayer = null;
      await expect(controller.onStop()).resolves.not.toThrow();
    });
  });

  describe('audio playback', () => {
    beforeEach(async () => {
      await controller.onStart();
    });

    it('should start playback on stream start', async () => {
      const format = {
        codec: 'opus',
        sample_rate: 48000,
        channels: 2,
        bit_depth: 16
      };

      // Trigger stream start callback
      await mockClient.config.onStreamStart(format);

      expect(mockDecoder.initialize).toHaveBeenCalledWith(format);
      expect(mockPlayer.start).toHaveBeenCalledWith(format);
    });

    it('should stop playback on stream end', async () => {
      // Start playback first
      await mockClient.config.onStreamStart({
        codec: 'opus',
        sample_rate: 48000,
        channels: 2
      });

      // Then end stream
      await mockClient.config.onStreamEnd();

      expect(mockPlayer.stop).toHaveBeenCalled();
      expect(mockDecoder.cleanup).toHaveBeenCalled();
    });

    it('should play decoded audio chunks', async () => {
      const format = {
        codec: 'opus',
        sample_rate: 48000,
        channels: 2
      };
      const pcmData = Buffer.from([1, 2, 3, 4, 5]); // Already decoded PCM

      // Set current format
      controller.currentStreamFormat = format;

      // Trigger audio chunk callback (audio is already decoded by client)
      await mockClient.config.onAudioChunk(pcmData, format);

      // Decoder should NOT be called - decoding happens in client
      expect(mockDecoder.decode).not.toHaveBeenCalled();
      // Player should receive decoded PCM data
      expect(mockPlayer.play).toHaveBeenCalledWith(pcmData);
    });
  });

  describe('getState', () => {
    it('should return disconnected state when client is started but not connected', async () => {
      await controller.onStart();
      mockClient.isConnected = false;
      mockClient.serverAddress = null;
      const state = controller.getState();

      expect(state.status).toBe('disconnected');
      expect(state.serverAddress).toBeNull();
    });

    it('should return connected state when client is connected', async () => {
      await controller.onStart();
      mockClient.isConnected = true;
      mockClient.serverAddress = '192.168.1.100:8927';
      const state = controller.getState();

      expect(state.status).toBe('connected');
      expect(state.serverAddress).toBe('192.168.1.100:8927');
    });

    it('should return disconnected state when not started', () => {
      const state = controller.getState();

      expect(state.status).toBe('disconnected');
      expect(state.serverAddress).toBeNull();
    });
  });

  describe('saveConfiguration', () => {
    it('should update enabled state', async () => {
      await controller.onStart();

      const saveData = {
        enabled: false
      };

      const configPromise = controller.saveConfiguration(saveData);
      
      // Handle kew promise
      let promise;
      if (configPromise && configPromise.promise) {
        promise = new Promise((resolve, reject) => {
          configPromise.promise.then(resolve, reject);
        });
      } else {
        promise = configPromise;
      }

      await promise;

      expect(mockConfig.set).toHaveBeenCalledWith('enabled', false);
    });

    it('should restart client when enabled state changes', async () => {
      await controller.onStart();

      // Set up mock to return false for enabled after save
      // First call (wasEnabled check) returns true, second call (isEnabled check) returns false
      let callCount = 0;
      mockConfig.get.mockImplementation((key) => {
        if (key === 'enabled') {
          callCount++;
          // First call checks wasEnabled (true), second call checks isEnabled (false after set)
          return callCount === 1 ? true : false;
        }
        return undefined;
      });

      const saveData = { enabled: false };
      
      const configPromise = controller.saveConfiguration(saveData);
      
      // Handle kew promise
      let promise;
      if (configPromise && configPromise.promise) {
        promise = new Promise((resolve, reject) => {
          configPromise.promise.then(resolve, reject);
        });
      } else {
        promise = configPromise;
      }

      await promise;

      expect(mockConfig.set).toHaveBeenCalledWith('enabled', false);
      expect(mockClient.stop).toHaveBeenCalled();
    });
  });
});
