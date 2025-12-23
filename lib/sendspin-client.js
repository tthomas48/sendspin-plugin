'use strict';

const WebSocket = require('ws');
const mdns = require('multicast-dns');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const ClockSync = require('./clock-sync');
const AudioScheduler = require('./audio-scheduler');

/**
 * Sendspin Protocol client that connects to servers
 * Implements the Sendspin Protocol player role per the reference Go implementation
 */
class SendspinClient {
  constructor(config = {}) {
    this.config = {
      serverAddr: config.serverAddr || null, // Manual server address (host:port) or null for discovery
      playerName: config.playerName || config.clientName || `${os.hostname().split('.')[0]}-sendspin-player`,
      bufferMs: config.bufferMs || 150, // Jitter buffer size in milliseconds
      volume: config.volume || 100, // Initial volume 0-100
      muted: config.muted || false, // Initial mute state
      discoveryTimeout: config.discoveryTimeout || 10000, // Server discovery timeout in ms
      deviceInfo: config.deviceInfo || {
        productName: 'Sendspin Volumio Player',
        manufacturer: 'Volumio',
        softwareVersion: '1.0.0'
      },
      logger: config.logger || console,
      ...config
    };
    
    this.ws = null; // WebSocket connection to server
    this.isConnected = false;
    this.currentStreamFormat = null;
    this.serverAddress = null;
    
    // Callbacks
    this.onAudioChunk = config.onAudioChunk || null;
    this.onStreamStart = config.onStreamStart || null;
    this.onStreamEnd = config.onStreamEnd || null;
    this.onStateChange = config.onStateChange || null;
    this.onMetadata = config.onMetadata || null;
    
    // Current metadata
    this.currentMetadata = null;
    
    // mDNS discovery
    this.mdnsInstance = null;
    this.mdnsAdvertiseInstance = null; // Separate instance for advertising
    this.discoveryCanceled = false;
    this.advertisePort = config.advertisePort || 8927; // Port for mDNS advertisement
    this.advertiseInterval = null; // Interval for periodic announcements
    
    // Client ID (UUID)
    this.clientId = uuidv4();
    
    // Clock synchronization
    this.clockSync = new ClockSync(this.config.logger);
    this.pendingSyncRequests = new Map(); // Map of client_transmitted -> timestamp
    this.clockSyncLoopInterval = null;
    this.initialSyncComplete = false;
    
    // Audio scheduler
    this.scheduler = null;
    
    // Audio decoder (will be initialized on stream/start)
    this.decoder = config.decoder || null;
  }

  /**
   * Start the client: advertise self, discover server (if needed) and connect
   */
  async start() {
    try {
      // Start mDNS advertisement so servers can discover this player
      this.startMDNSAdvertisement();
      
      // Determine server address
      if (this.config.serverAddr) {
        // Use manual server address
        this.serverAddress = this.config.serverAddr;
        this.config.logger.info(`[SendspinClient] Using manual server address: ${this.serverAddress}`);
      } else {
        // Discover server via mDNS
        this.config.logger.info('[SendspinClient] Starting server discovery...');
        this.serverAddress = await this.discoverServer();
        if (!this.serverAddress) {
          throw new Error('No server found after discovery timeout');
        }
        this.config.logger.info(`[SendspinClient] Discovered server at ${this.serverAddress}`);
      }
      
      // Connect to server
      await this.connect();
      
      this.config.logger.info('[SendspinClient] Client started and connected');
    } catch (error) {
      this.config.logger.error('[SendspinClient] Failed to start:', error);
      throw error;
    }
  }
  
  /**
   * Start mDNS advertisement for this player
   * Advertises as _sendspin._tcp.local so servers can discover this player
   * Sends unsolicited announcements periodically (not just responding to queries)
   */
  startMDNSAdvertisement() {
    try {
      this.mdnsAdvertiseInstance = mdns();
      
      // Get local IP addresses
      const interfaces = os.networkInterfaces();
      const localIPs = [];
      
      for (const ifaceName in interfaces) {
        const iface = interfaces[ifaceName];
        for (const addr of iface) {
          // Only include IPv4 addresses that are not loopback
          if (addr.family === 'IPv4' && !addr.internal) {
            localIPs.push(addr.address);
          }
        }
      }
      
      if (localIPs.length === 0) {
        this.config.logger.warn('[SendspinClient] No local IP addresses found for mDNS advertisement');
        return;
      }
      
      // Use first non-loopback IP as primary
      const primaryIP = localIPs[0];
      const hostname = os.hostname().split('.')[0]; // Remove domain if present
      const serviceName = `${this.config.playerName}._sendspin._tcp.local`;
      const targetName = `${hostname}.local`;
      
      // Helper function to build announcement response
      const buildAnnouncement = () => {
        const additionals = [
          {
            name: serviceName,
            type: 'SRV',
            data: {
              port: this.advertisePort,
              target: targetName,
              priority: 0,
              weight: 0
            },
            ttl: 120
          },
          {
            name: serviceName,
            type: 'TXT',
            data: [Buffer.from('path=/sendspin')],
            ttl: 120
          }
        ];
        
        // Add A records for each local IP
        for (const ip of localIPs) {
          additionals.push({
            name: targetName,
            type: 'A',
            data: ip,
            ttl: 120
          });
        }
        
        return {
          answers: [
            {
              name: '_sendspin._tcp.local',
              type: 'PTR',
              data: serviceName,
              ttl: 120
            }
          ],
          additionals: additionals
        };
      };
      
      // Send initial announcement immediately
      const sendAnnouncement = () => {
        try {
          this.mdnsAdvertiseInstance.respond(buildAnnouncement());
          this.config.logger.debug(`[SendspinClient] Sent mDNS announcement for player: ${serviceName} at ${primaryIP}:${this.advertisePort}`);
        } catch (error) {
          this.config.logger.warn('[SendspinClient] Error sending mDNS announcement:', error);
        }
      };
      
      // Send initial announcement
      sendAnnouncement();
      
      // Send periodic announcements every 10 seconds (mDNS spec recommends 10-60 seconds)
      this.advertiseInterval = setInterval(() => {
        sendAnnouncement();
      }, 10000);
      
      // Also respond to queries for _sendspin._tcp.local
      this.mdnsAdvertiseInstance.on('query', (query) => {
        // Check if query is for _sendspin._tcp.local
        const questions = query.questions || [];
        for (const question of questions) {
          if (question.type === 'PTR' && question.name === '_sendspin._tcp.local') {
            // Respond with our service
            this.mdnsAdvertiseInstance.respond(buildAnnouncement());
            this.config.logger.debug(`[SendspinClient] Responded to mDNS query for player: ${serviceName}`);
          }
        }
      });
      
      this.config.logger.info(`[SendspinClient] Started mDNS advertisement: ${serviceName} on port ${this.advertisePort} (IP: ${primaryIP})`);
    } catch (error) {
      this.config.logger.warn('[SendspinClient] Failed to start mDNS advertisement:', error);
      // Don't throw - advertisement is nice to have but not critical
    }
  }
  
  /**
   * Discover Sendspin server via mDNS
   * Browses for _sendspin-server._tcp.local services
   */
  async discoverServer() {
    return new Promise((resolve, reject) => {
      this.discoveryCanceled = false;
      this.mdnsInstance = mdns();
      
      const timeout = setTimeout(() => {
        this.discoveryCanceled = true;
        if (this.mdnsInstance) {
          this.mdnsInstance.destroy();
          this.mdnsInstance = null;
        }
        resolve(null); // Timeout - no server found
      }, this.config.discoveryTimeout);
      
      const discoveredServers = new Set(); // Track discovered servers to avoid duplicates
      
      // Browse for servers in a loop
      const browse = () => {
        if (this.discoveryCanceled) {
          clearTimeout(timeout);
          return;
        }
        
        const entries = [];
        
        // Query for _sendspin-server._tcp.local
        this.mdnsInstance.on('response', (response) => {
          if (this.discoveryCanceled) return;
          
          // Process answers
          if (response.answers) {
            for (const answer of response.answers) {
              if (answer.type === 'PTR' && answer.name === '_sendspin-server._tcp.local') {
                // Found a server service
                const serviceName = answer.data;
                
                // Look for SRV record
                for (const additional of response.additionals || []) {
                  if (additional.name === serviceName && additional.type === 'SRV') {
                    const port = additional.data.port;
                    const target = additional.data.target;
                    
                    // Look for A record for the target
                    for (const addr of response.additionals || []) {
                      if (addr.name === target && addr.type === 'A') {
                        const host = addr.data;
                        const serverKey = `${host}:${port}`;
                        
                        if (!discoveredServers.has(serverKey)) {
                          discoveredServers.add(serverKey);
                          this.config.logger.info(`[SendspinClient] Discovered server: ${serviceName} at ${host}:${port}`);
                          
                          // Found a server - resolve and cleanup
                          clearTimeout(timeout);
                          this.discoveryCanceled = true;
                          if (this.mdnsInstance) {
                            this.mdnsInstance.destroy();
                            this.mdnsInstance = null;
                          }
                          resolve(`${host}:${port}`);
                          return;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        });
        
        // Send query
        this.mdnsInstance.query('_sendspin-server._tcp.local', 'PTR');
        
        // Continue browsing after timeout if no server found yet
        if (!this.discoveryCanceled) {
          setTimeout(browse, 3000); // Query every 3 seconds
        }
      };
      
      // Start browsing
      browse();
    });
  }
  
  /**
   * Connect to Sendspin server via WebSocket
   */
  async connect() {
    return new Promise((resolve, reject) => {
      const url = `ws://${this.serverAddress}/sendspin`;
      this.config.logger.info(`[SendspinClient] Connecting to ${url}`);
      
      let timeoutCleared = false;
      let connectionResolved = false;
      
      // Set connection timeout (10 seconds)
      const timeout = setTimeout(() => {
        // Wrap everything in try-catch to prevent any errors from crashing the plugin
        try {
          if (timeoutCleared || connectionResolved) {
            return;
          }
          
          if (this.ws) {
            const state = this.ws.readyState;
            // WebSocket states: CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3
            // Only close if still connecting
            if (state === WebSocket.CONNECTING || state === 0) {
              this.config.logger.error('[SendspinClient] WebSocket connection timeout');
              
              // Safely clean up the WebSocket
              try {
                // Remove listeners first to prevent any callbacks
                if (this.ws && typeof this.ws.removeAllListeners === 'function') {
                  try {
                    this.ws.removeAllListeners();
                  } catch (removeError) {
                    // Ignore - listeners might already be removed
                  }
                }
                
                // Don't try to close the WebSocket - just clean up our reference
                // The WebSocket will close on its own or the server will close it
                // Attempting to close() can throw errors if the socket is already closed
                // WebSocket states: CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3
                if (this.ws) {
                  const currentState = this.ws.readyState;
                  if (currentState === WebSocket.CONNECTING || currentState === 0) {
                    // Socket is still connecting - it will timeout/close on its own
                    // We'll just remove our reference and let it close naturally
                    this.config.logger.debug('[SendspinClient] Leaving WebSocket to close naturally after timeout');
                  } else {
                    // Socket is already closing or closed - nothing to do
                    this.config.logger.debug(`[SendspinClient] Socket already in state ${currentState}`);
                  }
                }
              } catch (cleanupError) {
                // Ignore any errors during cleanup - socket might already be closed
                this.config.logger.debug('[SendspinClient] Error during timeout cleanup (ignored):', cleanupError.message || cleanupError);
              }
              
              // Clean up state
              this.ws = null;
              this.isConnected = false;
              
              // Reject the promise if not already resolved
              if (!connectionResolved) {
                connectionResolved = true;
                reject(new Error('WebSocket connection timeout'));
              }
            }
          } else if (!connectionResolved) {
            // WebSocket was null - connection never started
            connectionResolved = true;
            reject(new Error('WebSocket connection timeout - socket was never created'));
          }
        } catch (error) {
          // Catch-all to prevent any errors from crashing the plugin
          this.config.logger.error('[SendspinClient] Unexpected error in timeout handler (ignored):', error.message || error);
          // Still reject if not resolved
          if (!connectionResolved) {
            connectionResolved = true;
            reject(new Error('WebSocket connection timeout'));
          }
        }
      }, 10000);
      
      this.ws = new WebSocket(url);
      
      this.ws.on('open', async () => {
        if (connectionResolved) {
          return; // Already resolved/rejected
        }
        timeoutCleared = true;
        clearTimeout(timeout);
        this.config.logger.info('[SendspinClient] WebSocket connected');
        this.isConnected = true;
        
        // Send client/hello after connection
        try {
          this.sendClientHello();
        } catch (error) {
          this.config.logger.error('[SendspinClient] Error sending client/hello:', error);
          // Don't reject - connection is established, just log the error
        }
        
        if (this.onStateChange) {
          this.onStateChange({ connected: true });
        }
        
        connectionResolved = true;
        resolve();
      });
      
      this.ws.on('message', (data, isBinary) => {
        if (isBinary) {
          // Binary message - audio chunk
          this.handleBinaryMessage(data);
        } else {
          // Text message - protocol message
          this.handleTextMessage(data.toString());
        }
      });
      
      this.ws.on('error', (error) => {
        if (connectionResolved) {
          return; // Already resolved/rejected
        }
        timeoutCleared = true;
        clearTimeout(timeout);
        this.config.logger.error('[SendspinClient] WebSocket error:', error);
        this.isConnected = false;
        if (this.onStateChange) {
          this.onStateChange({ connected: false });
        }
        connectionResolved = true;
        reject(error);
      });
      
      this.ws.on('close', (code, reason) => {
        timeoutCleared = true;
        clearTimeout(timeout);
        this.config.logger.info(`[SendspinClient] WebSocket disconnected (code: ${code}, reason: ${reason || 'none'})`);
        this.isConnected = false;
        this.currentStreamFormat = null;
        
        // Only reject if connection wasn't already established
        if (!connectionResolved && code !== 1000) {
          // 1000 = normal closure, don't treat as error
          connectionResolved = true;
          reject(new Error(`WebSocket closed before connection established (code: ${code})`));
        }
        
        this.ws = null;
        
        if (this.onStateChange) {
          this.onStateChange({ connected: false });
        }
      });
    });
  }


  /**
   * Stop the client: send goodbye and close connection
   */
  async stop() {
    // Cancel discovery if in progress
    this.discoveryCanceled = true;
    
    // Stop clock sync loop
    this.stopClockSyncLoop();
    
    // Stop scheduler
    if (this.scheduler) {
      this.scheduler.stop();
      this.scheduler = null;
    }
    
    // Stop mDNS discovery
    if (this.mdnsInstance) {
      try {
        this.mdnsInstance.destroy();
      } catch (error) {
        this.config.logger.warn('[SendspinClient] Error destroying mDNS discovery instance:', error);
      }
      this.mdnsInstance = null;
    }
    
    // Stop mDNS advertisement
    if (this.advertiseInterval) {
      clearInterval(this.advertiseInterval);
      this.advertiseInterval = null;
    }
    
    if (this.mdnsAdvertiseInstance) {
      try {
        this.mdnsAdvertiseInstance.destroy();
      } catch (error) {
        this.config.logger.warn('[SendspinClient] Error destroying mDNS advertisement instance:', error);
      }
      this.mdnsAdvertiseInstance = null;
    }

    // Send goodbye message before closing
    if (this.ws && this.isConnected) {
      try {
        this.sendGoodbye();
        // Give a moment for goodbye to be sent
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        this.config.logger.warn('[SendspinClient] Error sending goodbye:', error);
      }
    }

    // Close WebSocket connection
    if (this.ws) {
      try {
        this.ws.close();
      } catch (error) {
        this.config.logger.warn('[SendspinClient] Error closing WebSocket:', error);
      }
      this.ws = null;
    }

    this.isConnected = false;
    this.currentStreamFormat = null;
    this.serverAddress = null;
    this.initialSyncComplete = false;
    this.pendingSyncRequests.clear();
    
    this.config.logger.info('[SendspinClient] Client stopped');
  }

  /**
   * Send client/hello message with full protocol format
   */
  sendClientHello() {
    // Build supported formats array (used by both versioned and legacy formats)
    const supportedFormats = [
      // PCM hi-res - highest quality first
      { codec: 'pcm', channels: 2, sample_rate: 192000, bit_depth: 24 },
      { codec: 'pcm', channels: 2, sample_rate: 176400, bit_depth: 24 },
      { codec: 'pcm', channels: 2, sample_rate: 96000, bit_depth: 24 },
      { codec: 'pcm', channels: 2, sample_rate: 88200, bit_depth: 24 },
      // PCM standard quality
      { codec: 'pcm', channels: 2, sample_rate: 48000, bit_depth: 16 },
      { codec: 'pcm', channels: 2, sample_rate: 44100, bit_depth: 16 },
      // Opus fallback (48kHz only - Opus spec requirement)
      { codec: 'opus', channels: 2, sample_rate: 48000, bit_depth: 16 }
    ];
    
    // Extract unique values for Music Assistant compatibility fields
    const codecs = [...new Set(supportedFormats.map(f => f.codec))];
    const channels = [...new Set(supportedFormats.map(f => f.channels))];
    const sampleRates = [...new Set(supportedFormats.map(f => f.sample_rate))];
    const bitDepths = [...new Set(supportedFormats.map(f => f.bit_depth))];
    
    const hello = {
      client_id: this.clientId,
      name: this.config.playerName,
      version: 1,
      supported_roles: ['player@v1', 'metadata@v1', 'artwork@v1', 'visualizer@v1'],
      device_info: {
        product_name: this.config.deviceInfo.productName,
        manufacturer: this.config.deviceInfo.manufacturer,
        software_version: this.config.deviceInfo.softwareVersion
      },
      // Versioned support fields (per Sendspin Protocol spec)
      'player@v1_support': {
        supported_formats: supportedFormats,
        buffer_capacity: 1048576,
        supported_commands: ['volume', 'mute'],
        // Legacy fields for Music Assistant backward compatibility
        // MA uses separate arrays instead of AudioFormat objects
        support_codecs: codecs,
        support_channels: channels,
        support_sample_rates: sampleRates,
        support_bit_depth: bitDepths
      },
      'artwork@v1_support': {
        channels: [
          {
            source: 'album',
            format: 'jpeg',
            media_width: 600,
            media_height: 600
          }
        ]
      },
      'visualizer@v1_support': {
        buffer_capacity: 1048576
      },
      // Legacy support fields for Music Assistant backward compatibility
      // Uses unversioned keys like "player_support" instead of "player@v1_support"
      player_support: {
        supported_formats: supportedFormats,
        buffer_capacity: 1048576,
        supported_commands: ['volume', 'mute'],
        support_codecs: codecs,
        support_channels: channels,
        support_sample_rates: sampleRates,
        support_bit_depth: bitDepths
      },
      metadata_support: {
        support_picture_formats: ['jpeg', 'png', 'webp'],
        media_width: 600,
        media_height: 600
      },
      artwork_support: {
        channels: [
          {
            source: 'album',
            format: 'jpeg',
            media_width: 600,
            media_height: 600
          }
        ]
      },
      visualizer_support: {
        buffer_capacity: 1048576
      }
    };
    
    const message = {
      type: 'client/hello',
      payload: hello
    };
    
    this.sendMessage(message);
    this.config.logger.info('[SendspinClient] Sent client/hello');
  }
  
  /**
   * Send initial client/state message after handshake
   */
  sendInitialState() {
    this.sendState('synchronized', this.config.volume, false);
  }
  
  /**
   * Send client/state message with current player state
   */
  sendState(state, volume, muted) {
    const stateMsg = {
      player: {
        state: state,
        volume: volume,
        muted: muted
      }
    };
    
    const message = {
      type: 'client/state',
      payload: stateMsg
    };
    
    this.sendMessage(message);
    this.config.logger.debug(`[SendspinClient] Sent client/state: state=${state}, volume=${volume}, muted=${muted}`);
  }
  
  /**
   * Send client/goodbye message before disconnecting
   */
  sendGoodbye() {
    const message = {
      type: 'client/goodbye',
      payload: {
        reason: 'shutdown'
      }
    };
    
    this.sendMessage(message);
    this.config.logger.info('[SendspinClient] Sent client/goodbye');
  }

  /**
   * Send client/time message for synchronization
   */
  sendClientTime(clientTransmitted) {
    const timeUs = clientTransmitted || Number(process.hrtime.bigint() / 1000n);
    
    // Store the request timestamp for matching with response
    this.pendingSyncRequests.set(timeUs, Date.now());
    
    const message = {
      type: 'client/time',
      payload: {
        client_transmitted: timeUs
      }
    };
    
    this.sendMessage(message);
    return timeUs;
  }
  
  /**
   * Handle server/time response
   */
  handleTimeSyncResponse(payload) {
    const clientTransmitted = payload.client_transmitted;
    const serverReceived = payload.server_received;
    const serverTransmitted = payload.server_transmitted;
    
    if (clientTransmitted === undefined || serverReceived === undefined || serverTransmitted === undefined) {
      this.config.logger.warn('[SendspinClient] Invalid server/time response: missing fields');
      return;
    }
    
    // Check if we have a pending request for this timestamp
    if (!this.pendingSyncRequests.has(clientTransmitted)) {
      this.config.logger.debug('[SendspinClient] Received stale time sync response');
      return;
    }
    
    // Remove from pending requests
    this.pendingSyncRequests.delete(clientTransmitted);
    
    // Calculate client receive time (now)
    const clientReceived = Number(process.hrtime.bigint() / 1000n);
    
    // Process sync response
    this.clockSync.processSyncResponse(
      clientTransmitted,
      serverReceived,
      serverTransmitted,
      clientReceived
    );
  }
  
  /**
   * Perform initial clock synchronization (5 rounds)
   */
  async performInitialSync() {
    this.config.logger.info('[SendspinClient] Performing initial clock synchronization...');
    
    for (let i = 0; i < 5; i++) {
      const t1 = Number(process.hrtime.bigint() / 1000n);
      
      // Create a promise that resolves when we get the response
      const syncPromise = new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.pendingSyncRequests.has(t1)) {
            clearInterval(checkInterval);
            resolve(true); // Response received
          }
        }, 10); // Check every 10ms
        
        // Timeout after 500ms
        setTimeout(() => {
          if (this.pendingSyncRequests.has(t1)) {
            clearInterval(checkInterval);
            this.pendingSyncRequests.delete(t1);
            this.config.logger.warn(`[SendspinClient] Initial sync round ${i + 1} timeout`);
            resolve(false); // Timeout
          }
        }, 500);
      });
      
      // Send sync request
      this.sendClientTime(t1);
      
      // Wait for response or timeout
      await syncPromise;
      
      // Brief pause between syncs
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const stats = this.clockSync.getStats();
    this.config.logger.info(`[SendspinClient] Initial clock sync complete: rtt=${stats.rtt}μs, quality=${stats.quality}`);
    this.initialSyncComplete = true;
  }
  
  /**
   * Start continuous clock synchronization loop (every 1 second)
   */
  startClockSyncLoop() {
    if (this.clockSyncLoopInterval) {
      return; // Already running
    }
    
    this.config.logger.info('[SendspinClient] Starting continuous clock sync loop');
    
    this.clockSyncLoopInterval = setInterval(() => {
      // Drain stale responses before sending new request
      const now = Date.now();
      const staleThreshold = 2000; // 2 seconds
      
      for (const [clientTransmitted, requestTime] of this.pendingSyncRequests.entries()) {
        if (now - requestTime > staleThreshold) {
          this.config.logger.debug('[SendspinClient] Discarded stale time sync response');
          this.pendingSyncRequests.delete(clientTransmitted);
        }
      }
      
      // Send new sync request
      this.sendClientTime();
    }, 1000); // Every 1 second
  }
  
  /**
   * Stop clock synchronization loop
   */
  stopClockSyncLoop() {
    if (this.clockSyncLoopInterval) {
      clearInterval(this.clockSyncLoopInterval);
      this.clockSyncLoopInterval = null;
      this.config.logger.info('[SendspinClient] Stopped clock sync loop');
    }
  }

  /**
   * Handle incoming text messages (protocol messages)
   */
  handleTextMessage(data) {
    try {
      const message = JSON.parse(data);
      const payload = message.payload || {};
      
      switch (message.type) {
        case 'server/hello':
          this.config.logger.info('[SendspinClient] Received server/hello');
          // Send initial state after handshake
          this.sendInitialState();
          // Start initial clock sync (5 rounds)
          this.performInitialSync().then(() => {
            // Start continuous sync loop after initial sync
            this.startClockSyncLoop();
          }).catch((error) => {
            this.config.logger.error('[SendspinClient] Initial sync failed:', error);
          });
          break;
          
        case 'server/time':
          // Time synchronization response
          this.handleTimeSyncResponse(payload);
          break;
          
        case 'server/state':
          // Server state update (metadata, controller state)
          if (payload.metadata) {
            this.handleMetadata(payload.metadata);
          }
          break;
          
        case 'stream/start':
          // Stream format notification
          if (payload.player) {
            const format = {
              codec: payload.player.codec,
              sample_rate: payload.player.sample_rate,
              channels: payload.player.channels,
              bit_depth: payload.player.bit_depth,
              codec_header: payload.player.codec_header
            };
            this.currentStreamFormat = format;
            
            // Initialize decoder if provided
            if (this.decoder && typeof this.decoder.initialize === 'function') {
              this.decoder.initialize(format).catch((error) => {
                this.config.logger.error('[SendspinClient] Failed to initialize decoder:', error);
              });
            }
            
            // Create scheduler for this stream
            this.scheduler = new AudioScheduler(
              this.clockSync,
              this.config.bufferMs,
              this.config.logger
            );
            
            // Start scheduler with callback for ready buffers (already decoded PCM)
            this.scheduler.start((pcmData) => {
              // Buffer is ready to play - call the audio chunk callback with decoded PCM
              if (this.onAudioChunk) {
                this.onAudioChunk(pcmData, format);
              }
            });
            
            if (this.onStreamStart) {
              this.onStreamStart(format);
            }
          }
          break;
          
        case 'stream/end':
          // Stream ended
          if (this.scheduler) {
            this.scheduler.stop();
            this.scheduler = null;
          }
          this.currentStreamFormat = null;
          if (this.onStreamEnd) {
            this.onStreamEnd();
          }
          break;
          
        case 'stream/clear':
          // Stream cleared (buffer reset, continue listening)
          if (this.scheduler) {
            this.scheduler.clear();
          }
          this.config.logger.info('[SendspinClient] Received stream/clear - buffers cleared');
          break;
          
        case 'server/command':
          // Server control command (volume, mute)
          if (payload.player) {
            const cmd = payload.player.command;
            if (cmd === 'volume' && payload.player.volume !== undefined) {
              this.config.volume = payload.player.volume;
              this.config.logger.info(`[SendspinClient] Volume command: ${payload.player.volume}`);
              // Send updated state
              this.sendState('synchronized', this.config.volume, false);
            } else if (cmd === 'mute' && payload.player.mute !== undefined) {
              this.config.muted = payload.player.mute;
              this.config.logger.info(`[SendspinClient] Mute command: ${payload.player.mute}`);
              // Send updated state
              this.sendState('synchronized', this.config.volume, this.config.muted);
            }
          }
          break;
          
        default:
          this.config.logger.debug(`[SendspinClient] Unhandled message type: ${message.type}`);
      }
    } catch (error) {
      this.config.logger.error('[SendspinClient] Error parsing message:', error);
    }
  }

  /**
   * Handle incoming binary messages (audio chunks)
   */
  async handleBinaryMessage(data) {
    // Binary message format:
    // First byte: message type (4 = audio chunk for player role)
    // Next 8 bytes: server timestamp (big-endian int64, microseconds)
    // Rest: audio data
    
    if (data.length < 9) {
      this.config.logger.warn('[SendspinClient] Binary message too short');
      return;
    }
    
    const messageType = data[0];
    if (messageType === 4) {
      // Audio chunk
      const timestamp = Number(data.readBigUInt64BE(1)); // Convert BigInt to Number
      const encodedAudioData = data.slice(9);
      
      // Decode and schedule audio chunk
      if (this.scheduler && this.decoder) {
        try {
          // Decode audio chunk to PCM
          const pcmData = await this.decoder.decode(encodedAudioData);
          
          // Schedule decoded PCM with timestamp
          this.scheduler.schedule(pcmData, timestamp);
        } catch (error) {
          this.config.logger.error('[SendspinClient] Decode error:', error);
          // Continue - don't block on decode errors
        }
      } else if (this.scheduler) {
        // No decoder - assume PCM pass-through
        this.scheduler.schedule(encodedAudioData, timestamp);
      } else {
        // Fallback: if scheduler not ready, call callback directly
        // This shouldn't happen in normal operation
        this.config.logger.warn('[SendspinClient] Received audio chunk but scheduler not initialized');
        if (this.onAudioChunk) {
          // Try to decode if decoder available
          if (this.decoder) {
            try {
              const pcmData = await this.decoder.decode(encodedAudioData);
              this.onAudioChunk(pcmData, this.currentStreamFormat);
            } catch (error) {
              this.config.logger.error('[SendspinClient] Decode error:', error);
            }
          } else {
            this.onAudioChunk(encodedAudioData, this.currentStreamFormat);
          }
        }
      }
    }
  }

  /**
   * Send a JSON message
   */
  sendMessage(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Disconnect (alias for stop for backward compatibility)
   */
  disconnect() {
    return this.stop();
  }
  
  /**
   * Get player statistics
   * @returns {Object} Player statistics
   */
  getStats() {
    const stats = {
      received: 0,
      played: 0,
      dropped: 0,
      bufferDepth: 0,
      syncRTT: 0,
      syncQuality: 'lost'
    };
    
    // Get scheduler stats if available
    if (this.scheduler) {
      const schedulerStats = this.scheduler.getStats();
      stats.received = schedulerStats.received;
      stats.played = schedulerStats.played;
      stats.dropped = schedulerStats.dropped;
      stats.bufferDepth = this.scheduler.getBufferDepth();
    }
    
    // Get clock sync stats
    const syncStats = this.clockSync.getStats();
    stats.syncRTT = syncStats.rtt;
    stats.syncQuality = syncStats.quality;
    
    return stats;
  }
  
  /**
   * Handle metadata updates
   */
  handleMetadata(metadata) {
    this.currentMetadata = {
      timestamp: metadata.timestamp || null,
      title: metadata.title || null,
      artist: metadata.artist || null,
      albumArtist: metadata.album_artist || null,
      album: metadata.album || null,
      artworkUrl: metadata.artwork_url || null,
      year: metadata.year || null,
      track: metadata.track || null,
      progress: metadata.progress ? {
        trackProgress: metadata.progress.track_progress,
        trackDuration: metadata.progress.track_duration
      } : null,
      repeat: metadata.repeat || null,
      shuffle: metadata.shuffle || null
    };
    
    this.config.logger.debug('[SendspinClient] Received metadata:', this.currentMetadata);
    
    if (this.onMetadata) {
      this.onMetadata(this.currentMetadata);
    }
  }
  
  /**
   * Get current player state
   * @returns {Object} Player state
   */
  getState() {
    return {
      connected: this.isConnected,
      state: this.currentStreamFormat ? 'playing' : 'idle',
      volume: this.config.volume,
      muted: this.config.muted,
      codec: this.currentStreamFormat?.codec || null,
      sampleRate: this.currentStreamFormat?.sample_rate || null,
      channels: this.currentStreamFormat?.channels || null,
      bitDepth: this.currentStreamFormat?.bit_depth || null,
      metadata: this.currentMetadata
    };
  }
}

module.exports = SendspinClient;
