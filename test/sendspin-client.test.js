'use strict';

const SendspinClient = require('../lib/sendspin-client');
const WebSocket = require('ws');
const ClockSync = require('../lib/clock-sync');
const AudioScheduler = require('../lib/audio-scheduler');

// Mock dependencies
jest.mock('ws');
jest.mock('multicast-dns');
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234')
}));
jest.mock('os', () => ({
  hostname: jest.fn(() => 'test-hostname')
}));

const mdns = require('multicast-dns');

describe('SendspinClient', () => {
  let client;
  let mockWs;
  let mockLogger;
  let mockMdnsInstance;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    // Create mock WebSocket (client connection)
    mockWs = {
      on: jest.fn(),
      send: jest.fn(),
      close: jest.fn(),
      readyState: WebSocket.CONNECTING
    };

    // Mock WebSocket constructor (client)
    WebSocket.mockImplementation((url) => {
      const ws = {
        on: jest.fn((event, handler) => {
          // Store handler and trigger 'open' event immediately for testing
          if (event === 'open') {
            // Trigger open handler asynchronously
            setImmediate(() => {
              handler();
            });
          }
        }),
        send: jest.fn(),
        close: jest.fn(),
        readyState: WebSocket.CONNECTING
      };
      
      // Update readyState after handlers are set
      setImmediate(() => {
        ws.readyState = WebSocket.OPEN;
      });
      
      return ws;
    });

    // Create mock mDNS instance
    mockMdnsInstance = {
      on: jest.fn(),
      query: jest.fn(),
      destroy: jest.fn()
    };

    // Mock multicast-dns - it's a function that returns an instance
    mdns.mockImplementation(() => mockMdnsInstance);
  });

  afterEach(async () => {
    if (client) {
      try {
        await client.stop();
      } catch (error) {
        // Ignore stop errors in cleanup
      }
      client = null;
    }
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      client = new SendspinClient();
      
      expect(client.config.serverAddr).toBeNull();
      expect(client.config.playerName).toBe('test-hostname-sendspin-player');
      expect(client.config.bufferMs).toBe(150);
      expect(client.config.volume).toBe(100);
      expect(client.isConnected).toBe(false);
      expect(client.ws).toBeNull();
      expect(client.clientId).toBe('test-uuid-1234');
      expect(client.clockSync).toBeInstanceOf(ClockSync);
    });

    it('should accept custom config', () => {
      client = new SendspinClient({
        serverAddr: '192.168.1.100:8927',
        playerName: 'TestPlayer',
        bufferMs: 200,
        volume: 80,
        logger: mockLogger
      });
      
      expect(client.config.serverAddr).toBe('192.168.1.100:8927');
      expect(client.config.playerName).toBe('TestPlayer');
      expect(client.config.bufferMs).toBe(200);
      expect(client.config.volume).toBe(80);
      expect(client.config.logger).toBe(mockLogger);
    });
  });

  describe('start', () => {
    it('should connect to manual server address', async () => {
      client = new SendspinClient({
        serverAddr: '192.168.1.100:8927',
        logger: mockLogger
      });

      const startPromise = client.start();
      
      // Wait for WebSocket connection to establish
      await new Promise(resolve => setTimeout(resolve, 10));
      await startPromise;

      expect(WebSocket).toHaveBeenCalledWith('ws://192.168.1.100:8927/sendspin');
      // Verify WebSocket was created (the mock returns our mockWs)
      expect(client.ws).toBeDefined();
      expect(client.isConnected).toBe(true);
    });

    it('should discover server via mDNS when serverAddr is null', async () => {
      client = new SendspinClient({
        serverAddr: null,
        logger: mockLogger,
        discoveryTimeout: 50 // Very short timeout for testing
      });

      // Mock mDNS discovery - simulate no server found (timeout)
      mockMdnsInstance.on.mockImplementation((event, handler) => {
        // Don't trigger response - let it timeout
      });
      mockMdnsInstance.query = jest.fn();

      // Override shouldReconnect getter to return false
      // This prevents reconnection scheduling and allows rejection
      Object.defineProperty(client, 'shouldReconnect', {
        get: () => false,
        set: () => {}, // Ignore sets
        configurable: true
      });

      const startPromise = client.start();
      
      // Should timeout and reject (since reconnection is disabled)
      await expect(startPromise).rejects.toThrow(/No server found|timeout/i);
    }, 10000);

    it('should send client/hello after connection', async () => {
      let wsInstance;
      WebSocket.mockImplementationOnce((url) => {
        wsInstance = {
          on: jest.fn((event, handler) => {
            if (event === 'open') {
              setImmediate(() => handler());
            }
          }),
          send: jest.fn(),
          close: jest.fn(),
          readyState: WebSocket.OPEN
        };
        return wsInstance;
      });

      client = new SendspinClient({
        serverAddr: 'localhost:8927',
        logger: mockLogger
      });

      const startPromise = client.start();
      await new Promise(resolve => setTimeout(resolve, 10));
      await startPromise;

      // Check that client/hello was sent
      expect(wsInstance.send).toHaveBeenCalled();
      const sentMessage = JSON.parse(wsInstance.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('client/hello');
      expect(sentMessage.payload.client_id).toBe('test-uuid-1234');
      expect(sentMessage.payload.name).toBe('test-hostname-sendspin-player');
      expect(sentMessage.payload.version).toBe(1);
      expect(sentMessage.payload.supported_roles).toContain('player@v1');
    });

    it('should handle connection errors', async () => {
      // Mock WebSocket to fail on connection by triggering error event immediately
      WebSocket.mockImplementationOnce((url) => {
        const ws = {
          on: jest.fn((event, handler) => {
            if (event === 'error') {
              // Trigger error asynchronously after a short delay
              setImmediate(() => {
                const connectionError = new Error('Connection failed');
                handler(connectionError);
              });
            }
          }),
          send: jest.fn(),
          close: jest.fn(),
          readyState: WebSocket.CLOSED
        };
        return ws;
      });

      client = new SendspinClient({
        serverAddr: 'localhost:8927',
        logger: mockLogger
      });

      // Override shouldReconnect getter to return false
      // This prevents reconnection scheduling and allows rejection
      Object.defineProperty(client, 'shouldReconnect', {
        get: () => false,
        set: () => {}, // Ignore sets
        configurable: true
      });

      const startPromise = client.start();
      
      // The promise should reject with the connection error (since reconnection is disabled)
      await expect(startPromise).rejects.toThrow('Connection failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[SendspinClient] WebSocket error (during connection):',
        expect.any(Error)
      );
    });
  });

  describe('protocol messages', () => {
    let wsInstance;
    
    beforeEach(async () => {
      wsInstance = {
        on: jest.fn((event, handler) => {
          if (event === 'open') {
            setImmediate(() => handler());
          }
        }),
        send: jest.fn(),
        close: jest.fn(),
        readyState: WebSocket.OPEN
      };
      
      WebSocket.mockImplementationOnce(() => wsInstance);
      
      client = new SendspinClient({
        serverAddr: 'localhost:8927',
        logger: mockLogger
      });
      
      const startPromise = client.start();
      await new Promise(resolve => setTimeout(resolve, 10));
      await startPromise;
    });

    it('should handle server/hello and send initial state', () => {
      const sendInitialStateSpy = jest.spyOn(client, 'sendInitialState');
      
      const messageHandler = wsInstance.on.mock.calls
        .find(call => call[0] === 'message')[1];
      
      messageHandler(JSON.stringify({
        type: 'server/hello',
        payload: {
          server_id: 'server-123',
          name: 'Test Server',
          version: 1,
          active_roles: ['player@v1']
        }
      }), false);

      expect(mockLogger.info).toHaveBeenCalledWith('[SendspinClient] Received server/hello');
      expect(sendInitialStateSpy).toHaveBeenCalled();
    });

    it('should handle stream/start and create scheduler', () => {
      const onStreamStart = jest.fn();
      client.onStreamStart = onStreamStart;
      
      const messageHandler = wsInstance.on.mock.calls
        .find(call => call[0] === 'message')[1];
      
      messageHandler(JSON.stringify({
        type: 'stream/start',
        payload: {
          player: {
            codec: 'pcm',
            sample_rate: 48000,
            channels: 2,
            bit_depth: 16
          }
        }
      }), false);

      expect(client.currentStreamFormat).toEqual({
        codec: 'pcm',
        sample_rate: 48000,
        channels: 2,
        bit_depth: 16,
        codec_header: undefined
      });
      expect(client.scheduler).toBeInstanceOf(AudioScheduler);
      expect(onStreamStart).toHaveBeenCalled();
    });

    it('should handle stream/end and stop scheduler', () => {
      const onStreamEnd = jest.fn();
      client.onStreamEnd = onStreamEnd;
      client.currentStreamFormat = { codec: 'pcm' };
      client.scheduler = new AudioScheduler(client.clockSync, 150, mockLogger);
      const stopSpy = jest.spyOn(client.scheduler, 'stop');

      const messageHandler = wsInstance.on.mock.calls
        .find(call => call[0] === 'message')[1];
      
      messageHandler(JSON.stringify({
        type: 'stream/end',
        payload: {}
      }), false);

      expect(stopSpy).toHaveBeenCalled();
      expect(client.currentStreamFormat).toBeNull();
      expect(client.scheduler).toBeNull();
      expect(onStreamEnd).toHaveBeenCalled();
    });

    it('should handle stream/clear and clear scheduler', () => {
      client.scheduler = new AudioScheduler(client.clockSync, 150, mockLogger);
      const clearSpy = jest.spyOn(client.scheduler, 'clear');

      const messageHandler = wsInstance.on.mock.calls
        .find(call => call[0] === 'message')[1];
      
      messageHandler(JSON.stringify({
        type: 'stream/clear',
        payload: {}
      }), false);

      expect(clearSpy).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('[SendspinClient] Buffers cleared, ready for new chunks');
    });

    it('should handle server/command volume', () => {
      const sendStateSpy = jest.spyOn(client, 'sendState');
      
      const messageHandler = wsInstance.on.mock.calls
        .find(call => call[0] === 'message')[1];
      
      messageHandler(JSON.stringify({
        type: 'server/command',
        payload: {
          player: {
            command: 'volume',
            volume: 75
          }
        }
      }), false);

      expect(client.config.volume).toBe(75);
      expect(sendStateSpy).toHaveBeenCalledWith('synchronized', 75, false);
    });

    it('should handle server/command mute', () => {
      const sendStateSpy = jest.spyOn(client, 'sendState');
      
      const messageHandler = wsInstance.on.mock.calls
        .find(call => call[0] === 'message')[1];
      
      messageHandler(JSON.stringify({
        type: 'server/command',
        payload: {
          player: {
            command: 'mute',
            mute: true
          }
        }
      }), false);

      expect(client.config.muted).toBe(true);
      expect(sendStateSpy).toHaveBeenCalledWith('synchronized', 100, true);
    });

    it('should handle server/state metadata', () => {
      const onMetadata = jest.fn();
      client.onMetadata = onMetadata;
      
      const messageHandler = wsInstance.on.mock.calls
        .find(call => call[0] === 'message')[1];
      
      messageHandler(JSON.stringify({
        type: 'server/state',
        payload: {
          metadata: {
            title: 'Test Song',
            artist: 'Test Artist',
            album: 'Test Album'
          }
        }
      }), false);

      expect(client.currentMetadata).toEqual({
        timestamp: null,
        title: 'Test Song',
        artist: 'Test Artist',
        albumArtist: null,
        album: 'Test Album',
        artworkUrl: null,
        year: null,
        track: null,
        progress: null,
        repeat: null,
        shuffle: null
      });
      expect(onMetadata).toHaveBeenCalled();
    });
  });

  describe('clock synchronization', () => {
    let wsInstance;
    
    beforeEach(async () => {
      wsInstance = {
        on: jest.fn((event, handler) => {
          if (event === 'open') {
            setImmediate(() => handler());
          }
        }),
        send: jest.fn(),
        close: jest.fn(),
        readyState: WebSocket.OPEN
      };
      
      WebSocket.mockImplementationOnce(() => wsInstance);
      
      client = new SendspinClient({
        serverAddr: 'localhost:8927',
        logger: mockLogger
      });
      
      const startPromise = client.start();
      await new Promise(resolve => setTimeout(resolve, 10));
      await startPromise;
    });

    it('should handle server/time response', () => {
      const processSpy = jest.spyOn(client.clockSync, 'processSyncResponse');
      
      // Send a time sync request first
      const t1 = Number(process.hrtime.bigint() / 1000n);
      client.sendClientTime(t1);
      
      // Simulate server/time response
      const messageHandler = wsInstance.on.mock.calls
        .find(call => call[0] === 'message')[1];
      
      messageHandler(JSON.stringify({
        type: 'server/time',
        payload: {
          client_transmitted: t1,
          server_received: 1000000,
          server_transmitted: 1000100
        }
      }), false);

      expect(processSpy).toHaveBeenCalled();
      const callArgs = processSpy.mock.calls[0];
      expect(callArgs[0]).toBe(t1); // client_transmitted
      expect(callArgs[1]).toBe(1000000); // server_received
      expect(callArgs[2]).toBe(1000100); // server_transmitted
      expect(typeof callArgs[3]).toBe('number'); // client_received
    });

    it('should perform initial sync after server/hello', async () => {
      const performInitialSyncSpy = jest.spyOn(client, 'performInitialSync').mockResolvedValue();
      const startClockSyncLoopSpy = jest.spyOn(client, 'startClockSyncLoop');
      
      const messageHandler = wsInstance.on.mock.calls
        .find(call => call[0] === 'message')[1];
      
      messageHandler(JSON.stringify({
        type: 'server/hello',
        payload: {}
      }), false);

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(performInitialSyncSpy).toHaveBeenCalled();
    });
  });

  describe('audio handling', () => {
    let wsInstance;
    
    beforeEach(async () => {
      wsInstance = {
        on: jest.fn((event, handler) => {
          if (event === 'open') {
            setImmediate(() => handler());
          }
        }),
        send: jest.fn(),
        close: jest.fn(),
        readyState: WebSocket.OPEN
      };
      
      WebSocket.mockImplementationOnce(() => wsInstance);
      
      client = new SendspinClient({
        serverAddr: 'localhost:8927',
        logger: mockLogger,
        decoder: {
          initialize: jest.fn().mockResolvedValue(),
          decode: jest.fn().mockResolvedValue(Buffer.from([1, 2, 3, 4]))
        }
      });
      
      const startPromise = client.start();
      await new Promise(resolve => setTimeout(resolve, 10));
      await startPromise;
      
      // Set up stream
      client.currentStreamFormat = { codec: 'pcm', sample_rate: 48000, channels: 2, bit_depth: 16 };
      client.scheduler = new AudioScheduler(client.clockSync, 150, mockLogger);
      client.scheduler.start(() => {});
    });

    it('should decode and schedule audio chunks', async () => {
      const scheduleSpy = jest.spyOn(client.scheduler, 'schedule');
      
      const messageHandler = wsInstance.on.mock.calls
        .find(call => call[0] === 'message')[1];
      
      // Create binary message: type 4, timestamp, audio data
      const timestamp = Buffer.alloc(8);
      timestamp.writeBigUInt64BE(BigInt(1234567890), 0);
      const audioData = Buffer.from([1, 2, 3, 4]);
      const binaryMessage = Buffer.concat([
        Buffer.from([4]), // Message type
        timestamp,
        audioData
      ]);

      // Wait for async decode and schedule
      await messageHandler(binaryMessage, true);
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(client.decoder.decode).toHaveBeenCalledWith(audioData);
      expect(scheduleSpy).toHaveBeenCalled();
    });

    it('should handle binary messages that are too short', async () => {
      const shortMessage = Buffer.from([4, 1, 2, 3]);
      
      const messageHandler = wsInstance.on.mock.calls
        .find(call => call[0] === 'message')[1];
      
      await messageHandler(shortMessage, true);

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('[SendspinClient] Binary message too short'));
    });
  });

  describe('stop', () => {
    it('should send goodbye and close connection', async () => {
      const wsInstance = {
        on: jest.fn((event, handler) => {
          if (event === 'open') {
            setImmediate(() => handler());
          }
        }),
        send: jest.fn(),
        close: jest.fn(),
        readyState: WebSocket.OPEN
      };
      
      WebSocket.mockImplementationOnce(() => wsInstance);
      
      client = new SendspinClient({
        serverAddr: 'localhost:8927',
        logger: mockLogger
      });
      
      const startPromise = client.start();
      await new Promise(resolve => setTimeout(resolve, 10));
      await startPromise;
      
      const sendGoodbyeSpy = jest.spyOn(client, 'sendGoodbye');
      const stopClockSyncLoopSpy = jest.spyOn(client, 'stopClockSyncLoop');
      
      await client.stop();

      expect(sendGoodbyeSpy).toHaveBeenCalled();
      expect(stopClockSyncLoopSpy).toHaveBeenCalled();
      expect(wsInstance.close).toHaveBeenCalled();
      expect(client.isConnected).toBe(false);
    });

    it('should stop scheduler if active', async () => {
      const wsInstance = {
        on: jest.fn((event, handler) => {
          if (event === 'open') {
            setImmediate(() => handler());
          }
        }),
        send: jest.fn(),
        close: jest.fn(),
        readyState: WebSocket.OPEN
      };
      
      WebSocket.mockImplementationOnce(() => wsInstance);
      
      client = new SendspinClient({
        serverAddr: 'localhost:8927',
        logger: mockLogger
      });
      
      const startPromise = client.start();
      await new Promise(resolve => setTimeout(resolve, 10));
      await startPromise;
      
      client.scheduler = new AudioScheduler(client.clockSync, 150, mockLogger);
      const stopSpy = jest.spyOn(client.scheduler, 'stop');
      
      await client.stop();

      expect(stopSpy).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return player statistics', async () => {
      const wsInstance = {
        on: jest.fn((event, handler) => {
          if (event === 'open') {
            setImmediate(() => handler());
          }
        }),
        send: jest.fn(),
        close: jest.fn(),
        readyState: WebSocket.OPEN
      };
      
      WebSocket.mockImplementationOnce(() => wsInstance);
      
      client = new SendspinClient({
        serverAddr: 'localhost:8927',
        logger: mockLogger
      });
      
      const startPromise = client.start();
      await new Promise(resolve => setTimeout(resolve, 10));
      await startPromise;
      
      client.scheduler = new AudioScheduler(client.clockSync, 150, mockLogger);
      
      const stats = client.getStats();
      
      expect(stats).toHaveProperty('received');
      expect(stats).toHaveProperty('played');
      expect(stats).toHaveProperty('dropped');
      expect(stats).toHaveProperty('bufferDepth');
      expect(stats).toHaveProperty('syncRTT');
      expect(stats).toHaveProperty('syncQuality');
    });
  });

  describe('getState', () => {
    it('should return current player state', async () => {
      const wsInstance = {
        on: jest.fn((event, handler) => {
          if (event === 'open') {
            setImmediate(() => handler());
          }
        }),
        send: jest.fn(),
        close: jest.fn(),
        readyState: WebSocket.OPEN
      };
      
      WebSocket.mockImplementationOnce(() => wsInstance);
      
      client = new SendspinClient({
        serverAddr: 'localhost:8927',
        logger: mockLogger
      });
      
      const startPromise = client.start();
      await new Promise(resolve => setTimeout(resolve, 10));
      await startPromise;
      
      const state = client.getState();
      
      expect(state).toHaveProperty('connected');
      expect(state).toHaveProperty('state');
      expect(state).toHaveProperty('volume');
      expect(state).toHaveProperty('muted');
      expect(state.connected).toBe(true);
    });
  });
});
