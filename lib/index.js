'use strict';

const fs = require('fs');
const path = require('path');
const kew = require('kew');
const vconf = require('v-conf');

class ControllerSendspin {
  constructor(context) {
    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.logger = this.context.logger;
    this.loggerPrefix = '[Sendspin]';
    
    // Config will be loaded in onVolumioStart
    this.config = null;
    
    // Sendspin client instance
    this.sendspinPlayer = null;
    // Audio decoder instance (for receiving audio IN)
    this.audioDecoder = null;
    // Audio player instance (for playing received audio via MPD)
    this.audioPlayer = null;
    // Current stream format for incoming audio
    this.currentStreamFormat = null;
  }

  onVolumioStart() {
    const self = this;
    
    // Load configuration file as per Volumio documentation
    // https://developers.volumio.com/plugins/index-js
    const configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new vconf();
    this.config.loadFile(configFile);
    
    return kew.resolve();
  }

  onStart() {
    const self = this;
    const defer = kew.defer();
    
    (async () => {
      try {
        // Check if plugin is enabled BEFORE logging start
        const enabled = self.config && typeof self.config.get === 'function' 
          ? self.config.get('enabled') !== false 
          : true; // Default to enabled if config not available
        
        if (!enabled) {
          self.logger.info(`${self.loggerPrefix} Plugin is disabled, not starting client`);
          defer.resolve();
          return;
        }
        
        // Check if already started
        if (self.sendspinPlayer) {
          self.logger.warn(`${self.loggerPrefix} Plugin already started, skipping`);
          defer.resolve();
          return;
        }
        
        self.logger.info(`${self.loggerPrefix} Starting Sendspin plugin...`);
        
        // Initialize audio decoder and player
        const AudioDecoder = require('./audio-decoder');
        const AudioPlayer = require('./audio-player');
        const SendspinClient = require('./sendspin-client');
        const os = require('os');
        
        self.audioDecoder = new AudioDecoder({
          logger: self.logger
        });
        
        self.audioPlayer = new AudioPlayer({
          commandRouter: self.commandRouter,
          logger: self.logger
        });
        
        // Get device name for player
        const deviceName = os.hostname().split('.')[0];
        
        // Get server address from config (optional - null means auto-discover)
        const serverAddr = self.config && typeof self.config.get === 'function'
          ? self.config.get('serverAddr') || null
          : null;
        
        // Initialize Sendspin client (connects to server)
        self.sendspinPlayer = new SendspinClient({
          serverAddr: serverAddr, // null = auto-discover via mDNS
          playerName: deviceName,
          bufferMs: 150, // Jitter buffer size
          volume: 100, // Initial volume
          decoder: self.audioDecoder, // Pass decoder to client for decoding before scheduling
          logger: self.logger,
          onStreamStart: async (format) => {
            self.logger.info(`${self.loggerPrefix} Stream started: ${format.codec} ${format.sample_rate}Hz`);
            await self.startAudioPlayback(format);
            self.broadcastState();
          },
          onStreamEnd: async () => {
            self.logger.info(`${self.loggerPrefix} Stream ended`);
            await self.stopAudioPlayback();
            self.broadcastState();
          },
          onAudioChunk: async (pcmData, format) => {
            // pcmData is already decoded PCM from scheduler (scheduled and ready to play)
            // Just play it directly - no need to decode again
            await self.handleIncomingAudio(pcmData, format);
          },
          onMetadata: (metadata) => {
            self.logger.info(`${self.loggerPrefix} Metadata: ${metadata.artist} - ${metadata.title} (${metadata.album})`);
            self.broadcastState();
          },
          onStateChange: (state) => {
            self.broadcastState();
          }
        });
        
        // Start client: discover server (if needed) and connect
        try {
          await self.sendspinPlayer.start();
          self.logger.info(`${self.loggerPrefix} Sendspin client started and connected`);
        } catch (error) {
          // Log error but don't crash the plugin - connection failures are recoverable
          self.logger.error(`${self.loggerPrefix} Failed to start:`, error.message || error);
          // Still resolve to allow plugin to continue (it will retry on next start)
          // Don't reject - this allows Volumio to continue operating
          defer.resolve();
          return;
        }
        
        self.logger.info(`${self.loggerPrefix} Sendspin plugin started`);
        defer.resolve();
      } catch (error) {
        self.logger.error(`${self.loggerPrefix} Failed to start:`, error);
        defer.reject(error);
      }
    })();
    
    return defer.promise;
  }

  onStop() {
    const self = this;
    const defer = kew.defer();
    
    (async () => {
      try {
        // Check if already stopped
        if (!self.sendspinPlayer) {
          self.logger.info(`${self.loggerPrefix} Plugin already stopped, skipping`);
          defer.resolve();
          return;
        }
        
        self.logger.info(`${self.loggerPrefix} Stopping Sendspin plugin...`);
        
        // Stop Sendspin client (sends goodbye, closes WebSocket, stops scheduler, stops mDNS)
        try {
          await self.sendspinPlayer.stop();
        } catch (error) {
          self.logger.warn(`${self.loggerPrefix} Error stopping client:`, error);
        }
        self.sendspinPlayer = null;
        
        // Stop audio playback (stops player and cleans up decoder)
        await self.stopAudioPlayback();
        
        // Clear any remaining state
        self.currentStreamFormat = null;
        
        self.logger.info(`${self.loggerPrefix} Sendspin plugin stopped`);
        defer.resolve();
      } catch (error) {
        self.logger.error(`${self.loggerPrefix} Error stopping:`, error);
        // Still resolve to avoid blocking Volumio shutdown
        defer.resolve();
      }
    })();
    
    return defer.promise;
  }
  
  /**
   * Called when plugin is uninstalled
   * Ensures complete cleanup of all resources
   */
  onUninstall() {
    const self = this;
    const defer = kew.defer();
    
    (async () => {
      try {
        self.logger.info(`${self.loggerPrefix} Uninstalling Sendspin plugin...`);
        
        // Perform full cleanup
        await self.onStop();
        
        // Additional cleanup for uninstall
        // Clear configuration if needed
        if (self.config) {
          // Optionally reset config to defaults
          // self.config.set('enabled', false);
        }
        
        self.logger.info(`${self.loggerPrefix} Sendspin plugin uninstalled`);
        defer.resolve();
      } catch (error) {
        self.logger.error(`${self.loggerPrefix} Error during uninstall:`, error);
        defer.resolve(); // Always resolve to avoid blocking uninstall
      }
    })();
    
    return defer.promise;
  }

  /**
   * Start audio playback for incoming streams
   */
  async startAudioPlayback(format) {
    if (this.audioPlayer && this.audioPlayer.isActive()) {
      this.logger.warn(`${this.loggerPrefix} Audio playback already active`);
      return;
    }

    try {
      // Initialize decoder with stream format
      if (this.audioDecoder) {
        await this.audioDecoder.initialize(format);
      }
      
      // Start player
      if (this.audioPlayer) {
        await this.audioPlayer.start(format);
      }
      
      this.currentStreamFormat = format;
      this.logger.info(`${this.loggerPrefix} Audio playback started`);
    } catch (error) {
      this.logger.error(`${this.loggerPrefix} Failed to start audio playback:`, error);
      throw error;
    }
  }

  /**
   * Stop audio playback and cleanup all audio resources
   */
  async stopAudioPlayback() {
    // Stop audio player first
    if (this.audioPlayer) {
      try {
        await this.audioPlayer.stop();
      } catch (error) {
        this.logger.error(`${this.loggerPrefix} Error stopping audio player:`, error);
      }
      // Cleanup player resources
      if (typeof this.audioPlayer.cleanup === 'function') {
        try {
          await this.audioPlayer.cleanup();
        } catch (error) {
          this.logger.error(`${this.loggerPrefix} Error cleaning up audio player:`, error);
        }
      }
      this.audioPlayer = null;
    }
    
    // Cleanup decoder
    if (this.audioDecoder) {
      try {
        this.audioDecoder.cleanup();
      } catch (error) {
        this.logger.error(`${this.loggerPrefix} Error cleaning up decoder:`, error);
      }
      this.audioDecoder = null;
    }
    
    // Clear stream format
    this.currentStreamFormat = null;
  }

  /**
   * Handle incoming audio chunk
   * Plays decoded PCM audio received from scheduler
   */
  async handleIncomingAudio(pcmData, format) {
    if (!this.audioPlayer) {
      this.logger.warn(`${this.loggerPrefix} Audio player not initialized, ignoring chunk`);
      return;
    }

    try {
      // Play decoded PCM data (already decoded by client's decoder)
      await this.audioPlayer.play(pcmData);
    } catch (error) {
      this.logger.error(`${this.loggerPrefix} Error playing audio chunk:`, error);
    }
  }

  onRestart() {
    // Restart logic
    return kew.resolve();
  }

  getUIConfig() {
    const self = this;
    try {
      const uiconf = fs.readFileSync(path.join(__dirname, 'UIConfig.json'), 'utf8');
      const config = JSON.parse(uiconf);
      
      // Volumio's i18n system will automatically handle TRANSLATE.* strings
      // if the i18n module and translation files are present
      // The translation files are in lib/i18n/strings_*.json
      
      return config;
    } catch (error) {
      this.logger.error(`${this.loggerPrefix} Error reading UIConfig:`, error);
      // Return default config if file read fails
      return {
        page: {
          label: 'TRANSLATE.SENDSPIN.PAGE_LABEL',
          title: 'TRANSLATE.SENDSPIN.PAGE_TITLE',
          description: 'TRANSLATE.SENDSPIN.PAGE_DESCRIPTION'
        },
        sections: []
      };
    }
  }

  setUIConfig(data) {
    const self = this;
    return kew.resolve();
  }

  /**
   * Save configuration from UI
   * Called when user saves settings in the UI
   */
  saveConfiguration(data) {
    const self = this;
    const defer = kew.defer();
    
    (async () => {
      try {
        // Track if enabled state changed
        const wasEnabled = this.config.get('enabled') !== false;
        
        // Update configuration values
        if (data.enabled !== undefined) {
          this.config.set('enabled', data.enabled);
        }
        // server_url is no longer needed - client advertises via mDNS

        // Check if enabled state changed
        const isEnabled = this.config.get('enabled') !== false;
        
        if (wasEnabled !== isEnabled) {
          if (isEnabled) {
            // Plugin was enabled - start the client
            this.logger.info(`${this.loggerPrefix} Plugin enabled, starting client...`);
            try {
              await this.onStart();
            } catch (error) {
              this.logger.error(`${this.loggerPrefix} Failed to start after enable:`, error);
              // Don't throw - allow UI to continue
            }
          } else {
            // Plugin was disabled - stop the client and cleanup
            this.logger.info(`${this.loggerPrefix} Plugin disabled, stopping client and cleaning up...`);
            try {
              await this.onStop();
            } catch (error) {
              this.logger.error(`${this.loggerPrefix} Error during disable cleanup:`, error);
              // Continue cleanup even if errors occur
            }
          }
        }

        this.logger.info(`${this.loggerPrefix} Configuration saved`);
        this.broadcastState();
        
        defer.resolve();
      } catch (error) {
        this.logger.error(`${this.loggerPrefix} Error saving configuration:`, error);
        defer.resolve(); // Still resolve to avoid breaking the UI
      }
    })();
    
    return defer.promise;
  }

  getConfigurationFiles() {
    return ['config.json'];
  }

  getState() {
    const self = this;
    if (this.sendspinPlayer) {
      return {
        status: this.sendspinPlayer.isConnected ? 'connected' : 'disconnected',
        serverAddress: this.sendspinPlayer.serverAddress || null,
        currentStreamFormat: this.currentStreamFormat,
        audioStreamActive: this.audioPlayer && this.audioPlayer.isActive()
      };
    }
    return {
      status: 'disconnected',
      serverAddress: null,
      currentStreamFormat: null,
      audioStreamActive: false
    };
  }

  broadcastState() {
    this.commandRouter.servicePushState('sendspin', this.getState());
  }
}

module.exports = ControllerSendspin;
