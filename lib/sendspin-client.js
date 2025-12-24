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
    this.onStreamClear = config.onStreamClear || null; // Callback for stream clear (seek)
    this.onStateChange = config.onStateChange || null;
    this.onMetadata = config.onMetadata || null;
    this.onPlaybackStateChange = config.onPlaybackStateChange || null; // Callback for playback state changes
    
    // Current metadata
    this.currentMetadata = null;
    
    // Playback state tracking
    this.playbackState = 'idle'; // 'playing', 'paused', 'idle', 'stopped'
    
    // mDNS discovery
    this.mdnsInstance = null;
    this.mdnsAdvertiseInstance = null; // Separate instance for advertising
    this.discoveryCanceled = false;
    this.advertisePort = config.advertisePort || 8927; // Port for mDNS advertisement
    this.advertiseInterval = null; // Interval for periodic announcements
    
    // Client ID (UUID) - use provided one or generate new
    // This should be persisted across restarts to maintain device identity
    this.clientId = config.clientId || uuidv4();
    
    // Clock synchronization
    this.clockSync = new ClockSync(this.config.logger);
    this.pendingSyncRequests = new Map(); // Map of client_transmitted -> timestamp
    this.clockSyncLoopInterval = null;
    this.initialSyncComplete = false;
    
    // Audio scheduler
    this.scheduler = null;
    
    // Audio decoder (will be initialized on stream/start)
    this.decoder = config.decoder || null;
    
    // Reconnection state
    this.shouldReconnect = false; // Set to true when start() is called, false when stop() is called
    this.reconnectAttempts = 0;
    this.reconnectTimeout = null;
    this.maxReconnectAttempts = Infinity; // Keep trying indefinitely
    this.reconnectDelay = 1000; // Start with 1 second delay
    this.maxReconnectDelay = 30000; // Max 30 seconds between attempts
  }

  /**
   * Start the client: advertise self, discover server (if needed) and connect
   */
  async start() {
    try {
      // Enable reconnection
      this.shouldReconnect = true;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000; // Reset delay
      
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
      
      // Reset reconnect attempts on successful connection
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      
      this.config.logger.info('[SendspinClient] Client started and connected');
    } catch (error) {
      this.config.logger.error('[SendspinClient] Failed to start:', error);
      // Don't throw - attempt reconnection if enabled
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      } else {
        throw error;
      }
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
        this.config.logger.debug(`[SendspinClient] WebSocket readyState: ${this.ws.readyState}, protocol: ${this.ws.protocol || 'none'}`);
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
        // Track total messages received
        if (!this._totalMessagesReceived) this._totalMessagesReceived = 0;
        this._totalMessagesReceived++;
        
        if (isBinary) {
          // Binary message - audio chunk
          // Log first 10 and every 100th to track flow
          if (this._totalMessagesReceived <= 10 || this._totalMessagesReceived % 100 === 0) {
            this.config.logger.info(`[SendspinClient] <<< WebSocket binary message #${this._totalMessagesReceived}: ${data.length} bytes`);
          } else {
            this.config.logger.debug(`[SendspinClient] <<< WebSocket binary message #${this._totalMessagesReceived}: ${data.length} bytes`);
          }
          this.handleBinaryMessage(data);
        } else {
          // Text message - protocol message
          this.config.logger.debug(`[SendspinClient] <<< WebSocket text message #${this._totalMessagesReceived}: ${data.length} bytes`);
          this.handleTextMessage(data.toString());
        }
      });
      
      this.ws.on('error', (error) => {
        if (connectionResolved) {
          // Connection was established but error occurred - will reconnect on close
          this.config.logger.error('[SendspinClient] WebSocket error (connection established):', error);
          this.isConnected = false;
          if (this.onStateChange) {
            this.onStateChange({ connected: false });
          }
          return; // Don't reject - let close handler handle reconnection
        }
        // Connection not yet established - reject the promise
        timeoutCleared = true;
        clearTimeout(timeout);
        this.config.logger.error('[SendspinClient] WebSocket error (during connection):', error);
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
        
        // Attempt reconnection if we should be connected
        if (this.shouldReconnect && connectionResolved) {
          // Connection was established but then closed - attempt reconnection
          this.config.logger.info('[SendspinClient] Connection lost, will attempt to reconnect...');
          this.scheduleReconnect();
        }
      });
    });
  }


  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  scheduleReconnect() {
    // Clear any existing reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    // Don't reconnect if we've been stopped
    if (!this.shouldReconnect) {
      this.config.logger.debug('[SendspinClient] Reconnection disabled (stop() called)');
      return;
    }
    
    // Check if we've exceeded max attempts
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.config.logger.error(`[SendspinClient] Max reconnection attempts (${this.maxReconnectAttempts}) reached, giving up`);
      return;
    }
    
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);
    
    this.config.logger.info(`[SendspinClient] Scheduling reconnection attempt #${this.reconnectAttempts} in ${delay}ms...`);
    
    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      
      if (!this.shouldReconnect) {
        this.config.logger.debug('[SendspinClient] Reconnection cancelled (stop() called)');
        return;
      }
      
      try {
        this.config.logger.info(`[SendspinClient] Attempting reconnection #${this.reconnectAttempts}...`);
        
        // If we don't have a server address (was discovered), rediscover
        if (!this.config.serverAddr && !this.serverAddress) {
          this.config.logger.info('[SendspinClient] Rediscovering server...');
          this.serverAddress = await this.discoverServer();
          if (!this.serverAddress) {
            this.config.logger.warn('[SendspinClient] Server not found during reconnection, will retry...');
            this.scheduleReconnect();
            return;
          }
        }
        
        // Attempt to reconnect
        await this.connect();
        
        // Reset reconnect state on successful connection
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.config.logger.info('[SendspinClient] Reconnection successful!');
      } catch (error) {
        this.config.logger.warn(`[SendspinClient] Reconnection attempt #${this.reconnectAttempts} failed:`, error.message);
        // Schedule next attempt
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Stop the client: send goodbye and close connection
   */
  async stop() {
    // Disable reconnection
    this.shouldReconnect = false;
    
    // Clear any pending reconnection
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
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
    // Use Date.now() * 1000 for Unix microseconds (not process.hrtime which is monotonic)
    const timeUs = clientTransmitted || (Date.now() * 1000);
    
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
    
    // Calculate client receive time (now) - use Unix microseconds
    const clientReceived = Date.now() * 1000;
    
    // Process sync response
    const rtt = (clientReceived - clientTransmitted) - (serverTransmitted - serverReceived);
    this.config.logger.debug(`[SendspinClient] Clock sync: t1=${clientTransmitted}μs, t2=${serverReceived}μs, t3=${serverTransmitted}μs, t4=${clientReceived}μs, rtt=${rtt}μs`);
    
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
      // Use Date.now() * 1000 for Unix microseconds
      const t1 = Date.now() * 1000;
      
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
    const syncStatus = this.clockSync.isSynced() ? 'SYNCED' : 'NOT SYNCED';
    this.config.logger.info(`[SendspinClient] Initial clock sync complete: ${syncStatus}, rtt=${stats.rtt}μs, quality=${stats.quality}, serverLoopStart=${this.clockSync.serverLoopStartUnix}`);
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
      let drained = 0;
      
      for (const [clientTransmitted, requestTime] of this.pendingSyncRequests.entries()) {
        if (now - requestTime > staleThreshold) {
          this.config.logger.debug('[SendspinClient] Discarded stale time sync response');
          this.pendingSyncRequests.delete(clientTransmitted);
          drained++;
        }
      }
      
      if (drained > 0) {
        this.config.logger.debug(`[SendspinClient] Drained ${drained} stale sync requests`);
      }
      
      // Check sync status before sending
      const stats = this.clockSync.getStats();
      const wasSynced = this.clockSync.isSynced();
      
      // If sync was lost, log warning
      if (stats.quality === 'lost' && wasSynced) {
        this.config.logger.warn(`[SendspinClient] Clock sync LOST! Last sync was >5s ago. Attempting to re-establish sync.`);
        
        // If we have a scheduler and it's running, it will detect the hang and attempt recovery
        // But we should also try to re-sync aggressively
        if (this.scheduler && this.scheduler.running) {
          this.config.logger.warn(`[SendspinClient] Scheduler is running but sync is lost. Scheduler will attempt recovery.`);
        }
      }
      
      this.config.logger.debug(`[SendspinClient] Continuous sync: quality=${stats.quality}, rtt=${stats.rtt}μs, synced=${this.clockSync.isSynced()}`);
      
      // Send new sync request
      const t1 = this.sendClientTime();
      this.config.logger.debug(`[SendspinClient] Sent continuous sync request: t1=${t1}μs`);
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
      
      // Log full message for debugging
      this.config.logger.debug(`[SendspinClient] <<< RECEIVED: ${message.type}`);
      this.config.logger.debug(`[SendspinClient] <<< PAYLOAD: ${JSON.stringify(payload, null, 2)}`);
      
      switch (message.type) {
        case 'server/hello':
          this.config.logger.info('[SendspinClient] Received server/hello');
          this.config.logger.debug(`[SendspinClient] Server info: ${JSON.stringify(payload, null, 2)}`);
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
          this.config.logger.debug(`[SendspinClient] Time sync: client_tx=${payload.client_transmitted}, server_rx=${payload.server_received}, server_tx=${payload.server_transmitted}`);
          this.handleTimeSyncResponse(payload);
          break;
          
        case 'server/state':
          // Server state update (metadata, controller state)
          this.config.logger.info(`[SendspinClient] <<< server/state: has_metadata=${!!payload.metadata}, has_controller=${!!payload.controller}`);
          if (payload.metadata) {
            this.config.logger.info(`[SendspinClient] <<< server/state metadata payload: ${JSON.stringify(payload.metadata, null, 2)}`);
            this.handleMetadata(payload.metadata);
          } else {
            this.config.logger.info(`[SendspinClient] <<< server/state: No metadata in payload`);
          }
          if (payload.controller) {
            this.config.logger.debug(`[SendspinClient] Controller state: ${JSON.stringify(payload.controller, null, 2)}`);
          }
          break;
          
        case 'group/update':
        case 'session/update':
          // Playback state update from server (paused/playing/stopped)
          this.config.logger.info(`[SendspinClient] ${message.type}: playback_state=${payload.playback_state || 'unknown'}`);
          if (payload.playback_state) {
            const newState = payload.playback_state.toLowerCase();
            if (newState !== this.playbackState) {
              this.config.logger.info(`[SendspinClient] Playback state changed: ${this.playbackState} -> ${newState}`);
              this.playbackState = newState;
              
              // Notify callback
              if (this.onPlaybackStateChange) {
                this.onPlaybackStateChange(newState);
              }
            }
          }
          break;
          
        case 'stream/start':
          // Stream format notification
          this.config.logger.info('[SendspinClient] Stream start received');
          if (payload.player) {
            const format = {
              codec: payload.player.codec,
              sample_rate: payload.player.sample_rate,
              channels: payload.player.channels,
              bit_depth: payload.player.bit_depth,
              codec_header: payload.player.codec_header
            };
            this.config.logger.debug(`[SendspinClient] Stream format: ${JSON.stringify(format, null, 2)}`);
            this.currentStreamFormat = format;
            
            // Initialize decoder if provided
            if (this.decoder && typeof this.decoder.initialize === 'function') {
              this.decoder.initialize(format).catch((error) => {
                this.config.logger.error('[SendspinClient] Failed to initialize decoder:', error);
                this.config.logger.error('[SendspinClient] Decoder initialization error details:', error.stack);
              });
            } else {
              this.config.logger.warn(`[SendspinClient] Decoder not available for initialization: decoder=${!!this.decoder}, hasInitialize=${!!(this.decoder && this.decoder.initialize)}`);
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
          this.config.logger.info('[SendspinClient] Stream end received');
          this.config.logger.debug(`[SendspinClient] Stream end payload: ${JSON.stringify(payload, null, 2)}`);
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
          // This happens on seek/fast-forward - clear buffers but keep stream active
          this.config.logger.info('[SendspinClient] Received stream/clear - clearing buffers');
          if (this.scheduler) {
            this.scheduler.clear();
          }
          // Notify callback to clear audio player buffer
          if (this.onStreamClear) {
            this.onStreamClear();
          }
          this.config.logger.info('[SendspinClient] Buffers cleared, ready for new chunks');
          break;
          
        case 'server/command':
          // Server control command (volume, mute)
          this.config.logger.info(`[SendspinClient] Server command received: ${JSON.stringify(payload, null, 2)}`);
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
            } else {
              this.config.logger.warn(`[SendspinClient] Unknown command: ${cmd}`);
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
      this.config.logger.warn(`[SendspinClient] Binary message too short: ${data.length} bytes (expected at least 9)`);
      return;
    }
    
    const messageType = data[0];
    const timestamp = Number(data.readBigUInt64BE(1)); // Convert BigInt to Number
    const encodedAudioData = data.slice(9);
    
    // Track binary message count for logging
    if (!this._binaryMessageCount) this._binaryMessageCount = 0;
    this._binaryMessageCount++;
    
    // Log binary message details (but not the full audio data to avoid log spam)
    // Log first 10 and then every 100th message
    if (this._binaryMessageCount <= 10 || this._binaryMessageCount % 100 === 0) {
      const syncStats = this.clockSync.getStats();
      const serverNow = this.clockSync.serverMicrosNow();
      const diff = timestamp - serverNow;
      this.config.logger.info(`[SendspinClient] <<< BINARY #${this._binaryMessageCount}: type=${messageType}, timestamp=${timestamp}μs, serverNow=${serverNow}μs, diff=${diff}μs (${(diff/1000).toFixed(1)}ms), size=${data.length} bytes, audio=${encodedAudioData.length} bytes, sync=${syncStats.quality}`);
    } else {
      this.config.logger.debug(`[SendspinClient] <<< BINARY #${this._binaryMessageCount}: type=${messageType}, timestamp=${timestamp}μs, size=${data.length} bytes, audio=${encodedAudioData.length} bytes`);
    }
    
    if (messageType === 4) {
      // Audio chunk
      
      // Log scheduler/decoder state for first few chunks
      if (this._binaryMessageCount <= 5) {
        this.config.logger.info(`[SendspinClient] Processing audio chunk #${this._binaryMessageCount}: scheduler=${!!this.scheduler}, decoder=${!!this.decoder}, scheduler.running=${this.scheduler?.running}`);
      }
      
      // Decode and schedule audio chunk
      if (this.scheduler && this.decoder) {
        try {
          // Decode audio chunk to PCM
          if (this._binaryMessageCount <= 5) {
            this.config.logger.info(`[SendspinClient] Decoding chunk #${this._binaryMessageCount}: ${encodedAudioData.length} bytes`);
          }
          
          // Add timeout to decode operation (1 second max - FFmpeg should be fast)
          const decodePromise = this.decoder.decode(encodedAudioData);
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Decode timeout after 1 second')), 1000);
          });
          
          const pcmData = await Promise.race([decodePromise, timeoutPromise]);
          
          if (this._binaryMessageCount <= 5) {
            this.config.logger.info(`[SendspinClient] Decoded chunk #${this._binaryMessageCount}: ${encodedAudioData.length} bytes -> ${pcmData.length} bytes PCM`);
          } else {
            this.config.logger.debug(`[SendspinClient] Decoded audio: ${encodedAudioData.length} bytes -> ${pcmData.length} bytes PCM`);
          }
          
          // Schedule decoded PCM with timestamp
          if (this._binaryMessageCount <= 5) {
            this.config.logger.info(`[SendspinClient] Scheduling chunk #${this._binaryMessageCount}: timestamp=${timestamp}μs`);
          }
          this.scheduler.schedule(pcmData, timestamp);
          
          if (this._binaryMessageCount <= 5) {
            this.config.logger.info(`[SendspinClient] Scheduled chunk #${this._binaryMessageCount}: queue size=${this.scheduler.bufferQueue.length}`);
          }
        } catch (error) {
          this.config.logger.error(`[SendspinClient] Decode error for chunk #${this._binaryMessageCount}: ${error.message}`, error);
          // Continue - don't block on decode errors, but log them
          if (this._binaryMessageCount <= 10) {
            this.config.logger.error(`[SendspinClient] Decode error details:`, error.stack);
          }
        }
      } else if (this.scheduler) {
        // No decoder - assume PCM pass-through
        if (this._binaryMessageCount <= 5) {
          this.config.logger.info(`[SendspinClient] Scheduling PCM pass-through chunk #${this._binaryMessageCount}: ${encodedAudioData.length} bytes, timestamp=${timestamp}μs`);
        } else {
          this.config.logger.debug(`[SendspinClient] Scheduling PCM pass-through: ${encodedAudioData.length} bytes`);
        }
        this.scheduler.schedule(encodedAudioData, timestamp);
      } else {
        // Fallback: if scheduler not ready, call callback directly
        // This shouldn't happen in normal operation
        this.config.logger.warn(`[SendspinClient] Received audio chunk #${this._binaryMessageCount} but scheduler not initialized (scheduler=${!!this.scheduler}, decoder=${!!this.decoder})`);
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
    } else if (messageType === 8) {
      // Type 8: Likely artwork or other metadata
      this.config.logger.debug(`[SendspinClient] Received binary message type 8 (artwork/metadata?): ${data.length} bytes`);
      // For now, just log it - we can handle artwork later if needed
    } else {
      this.config.logger.warn(`[SendspinClient] Unknown binary message type: ${messageType}`);
    }
  }

  /**
   * Send a JSON message
   */
  sendMessage(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const messageStr = JSON.stringify(message);
      // Log full message for debugging
      this.config.logger.debug(`[SendspinClient] >>> SENDING: ${message.type}`);
      this.config.logger.debug(`[SendspinClient] >>> PAYLOAD: ${JSON.stringify(message.payload, null, 2)}`);
      this.ws.send(messageStr);
    } else {
      this.config.logger.warn(`[SendspinClient] Cannot send message ${message.type}: WebSocket not open (state: ${this.ws ? this.ws.readyState : 'null'})`);
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
    this.config.logger.info(`[SendspinClient] handleMetadata called with: ${JSON.stringify(metadata, null, 2)}`);
    
    // Check if metadata fields are null/undefined (server may send null to clear)
    const hasTitle = metadata.title !== null && metadata.title !== undefined;
    const hasArtist = metadata.artist !== null && metadata.artist !== undefined;
    const hasArtwork = metadata.artwork_url !== null && metadata.artwork_url !== undefined && metadata.artwork_url !== '';
    
    this.config.logger.info(`[SendspinClient] Metadata fields: title=${hasTitle ? `"${metadata.title}"` : 'null/undefined'}, artist=${hasArtist ? `"${metadata.artist}"` : 'null/undefined'}, album=${metadata.album || 'null/undefined'}, artwork_url=${hasArtwork ? `"${metadata.artwork_url}"` : 'null/undefined/empty'}`);
    
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
    
    this.config.logger.info(`[SendspinClient] Processed metadata object: ${JSON.stringify(this.currentMetadata, null, 2)}`);
    this.config.logger.info(`[SendspinClient] onMetadata callback exists: ${!!this.onMetadata}`);
    
    if (this.onMetadata) {
      this.config.logger.info(`[SendspinClient] Calling onMetadata callback with processed metadata`);
      try {
        this.onMetadata(this.currentMetadata);
        this.config.logger.info(`[SendspinClient] onMetadata callback completed successfully`);
      } catch (error) {
        this.config.logger.error(`[SendspinClient] Error in onMetadata callback:`, error);
      }
    } else {
      this.config.logger.warn(`[SendspinClient] No onMetadata callback registered!`);
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

