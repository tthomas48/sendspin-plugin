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
    // Current metadata (title, artist, album, artwork, etc.)
    this.currentMetadata = null;
    // Playback state tracking
    this.currentPlaybackState = 'idle'; // 'playing', 'paused', 'idle', 'stopped'
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
        
        // Get or generate persistent client ID
        // This ensures Music Assistant sees the same device across restarts
        let clientId = null;
        if (self.config && typeof self.config.get === 'function') {
          clientId = self.config.get('clientId');
        }
        
        // Generate new client ID if not found in config
        if (!clientId) {
          const { v4: uuidv4 } = require('uuid');
          clientId = uuidv4();
          // Save to config for persistence
          if (self.config && typeof self.config.set === 'function') {
            self.config.set('clientId', clientId);
            self.logger.info(`${self.loggerPrefix} Generated new client ID: ${clientId}`);
          }
        } else {
          self.logger.info(`${self.loggerPrefix} Using persisted client ID: ${clientId}`);
        }
        
        // Initialize Sendspin client (connects to server)
        self.sendspinPlayer = new SendspinClient({
          serverAddr: serverAddr, // null = auto-discover via mDNS
          playerName: deviceName,
          clientId: clientId, // Persistent client ID
          bufferMs: 11000, // Jitter buffer size: ~2MB at 48kHz stereo 16-bit (11000ms = ~2MB / 192KB/s)
          volume: 100, // Initial volume
          decoder: self.audioDecoder, // Pass decoder to client for decoding before scheduling
          logger: self.logger,
          onStreamStart: async (format) => {
            self.logger.info(`${self.loggerPrefix} Stream started: ${format.codec} ${format.sample_rate}Hz`);
            // Initialize playback state to 'playing' when stream starts
            self.currentPlaybackState = 'playing';
            await self.startAudioPlayback(format);
            self.broadcastState();
          },
          onStreamEnd: async () => {
            self.logger.info(`${self.loggerPrefix} Stream ended`);
            await self.stopAudioPlayback();
            self.broadcastState();
          },
          onStreamClear: () => {
            // Stream cleared (seek/fast-forward) - clear audio player buffer but keep it active
            self.logger.info(`${self.loggerPrefix} Stream cleared (seek detected)`);
            if (self.audioPlayer && typeof self.audioPlayer.clearBuffer === 'function') {
              self.audioPlayer.clearBuffer();
            }
            // Ensure playback continues - scheduler will re-enter buffering mode
            // and new chunks will start playing once buffered
          },
          onAudioChunk: async (pcmData, format) => {
            // pcmData is already decoded PCM from scheduler (scheduled and ready to play)
            // Just play it directly - no need to decode again
            try {
              await self.handleIncomingAudio(pcmData, format);
            } catch (error) {
              self.logger.error(`${self.loggerPrefix} Error in onAudioChunk callback:`, error);
            }
          },
          onMetadata: (metadata) => {
            self.logger.info(`${self.loggerPrefix} onMetadata callback received: ${JSON.stringify(metadata, null, 2)}`);
            
            // Store metadata for display
            self.currentMetadata = metadata;
            
            // Check what we received
            const hasTitle = metadata && metadata.title !== null && metadata.title !== undefined && metadata.title !== '';
            const hasArtist = metadata && metadata.artist !== null && metadata.artist !== undefined && metadata.artist !== '';
            
            self.logger.info(`${self.loggerPrefix} Metadata check: hasTitle=${hasTitle}, hasArtist=${hasArtist}, title="${metadata?.title || 'null'}", artist="${metadata?.artist || 'null'}"`);
            
            // Only log and update if we have valid metadata
            if (metadata && (hasTitle || hasArtist)) {
              self.logger.info(`${self.loggerPrefix} Metadata: ${metadata.artist || 'Unknown'} - ${metadata.title || 'Unknown'} (${metadata.album || 'Unknown'})`);
              
              // Update Volumio's now playing state with metadata
              self.logger.info(`${self.loggerPrefix} Calling updateNowPlaying with metadata`);
              self.updateNowPlaying(metadata);
            } else {
              self.logger.warn(`${self.loggerPrefix} Received metadata but it's empty or invalid (title="${metadata?.title}", artist="${metadata?.artist}"), skipping update`);
            }
            
            // Always broadcast plugin state (even if metadata is empty)
            self.broadcastState();
          },
          onStateChange: (state) => {
            self.broadcastState();
          },
          onPlaybackStateChange: (playbackState) => {
            // Handle playback state changes from server (playing/paused/stopped)
            self.logger.info(`${self.loggerPrefix} Playback state changed: ${playbackState}`);
            self.handlePlaybackStateChange(playbackState);
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
      // Recreate decoder if it was cleaned up (e.g., after stream/end)
      if (!this.audioDecoder) {
        this.logger.info(`${this.loggerPrefix} Recreating audio decoder (was null)`);
        const AudioDecoder = require('./audio-decoder');
        this.audioDecoder = new AudioDecoder({
          logger: this.logger
        });
      }
      
      // Initialize decoder with stream format
      if (this.audioDecoder) {
        this.logger.info(`${this.loggerPrefix} Initializing decoder with format: ${format.codec} ${format.sample_rate}Hz ${format.channels}ch`);
        await this.audioDecoder.initialize(format);
        this.logger.info(`${this.loggerPrefix} Decoder initialized successfully. isInitialized: ${this.audioDecoder.isInitialized}, has decoder: ${!!this.audioDecoder.decoder}`);
      } else {
        this.logger.error(`${this.loggerPrefix} Failed to create audio decoder!`);
        throw new Error('Failed to create audio decoder');
      }
      
      // Recreate audio player if it was cleaned up
      if (!this.audioPlayer) {
        this.logger.info(`${this.loggerPrefix} Recreating audio player (was null)`);
        const AudioPlayer = require('./audio-player');
        this.audioPlayer = new AudioPlayer({
          commandRouter: this.commandRouter,
          logger: this.logger
        });
      }
      
      // Start player
      if (this.audioPlayer) {
        await this.audioPlayer.start(format);
      } else {
        this.logger.error(`${this.loggerPrefix} Failed to create audio player!`);
        throw new Error('Failed to create audio player');
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
      // Cleanup player resources but keep instance for reuse
      if (typeof this.audioPlayer.cleanup === 'function') {
        try {
          await this.audioPlayer.cleanup();
        } catch (error) {
          this.logger.error(`${this.loggerPrefix} Error cleaning up audio player:`, error);
        }
      }
      // Don't set to null - will be reused in startAudioPlayback
    }
    
    // Cleanup decoder but keep instance for reuse
    if (this.audioDecoder) {
      try {
        this.audioDecoder.cleanup();
      } catch (error) {
        this.logger.error(`${this.loggerPrefix} Error cleaning up decoder:`, error);
      }
      // Don't set to null - will be reused in startAudioPlayback
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
      // Try to restart audio playback if we have a format
      if (this.currentStreamFormat) {
        this.logger.info(`${this.loggerPrefix} Attempting to restart audio playback...`);
        try {
          await this.startAudioPlayback(this.currentStreamFormat);
        } catch (error) {
          this.logger.error(`${this.loggerPrefix} Failed to restart audio playback:`, error);
        }
      }
      return;
    }

    // Check if audio player is active - if not, try to restart it
    if (!this.audioPlayer.isActive() && this.currentStreamFormat) {
      this.logger.warn(`${this.loggerPrefix} Audio player not active, attempting to restart...`);
      try {
        await this.audioPlayer.start(this.currentStreamFormat);
      } catch (error) {
        this.logger.error(`${this.loggerPrefix} Failed to restart audio player:`, error);
        return;
      }
    }

    // Don't play chunks if we're paused - but keep the player initialized
    // MPD will handle pausing the stream, but we should still buffer chunks
    // so playback can resume smoothly
    if (this.currentPlaybackState === 'paused') {
      // Still try to push to buffer, but don't log warnings
      // The audio player's play() method will handle the paused state
      try {
        await this.audioPlayer.play(pcmData);
      } catch (error) {
        // Silently ignore errors when paused - MPD is paused so it won't consume data
        this.logger.debug(`${this.loggerPrefix} Chunk dropped while paused (expected):`, error.message);
      }
      return;
    }

    try {
      // Log first few chunks to verify flow
      if (!this._audioChunkCount) this._audioChunkCount = 0;
      this._audioChunkCount++;
      if (this._audioChunkCount <= 5 || this._audioChunkCount % 100 === 0) {
        this.logger.info(`${this.loggerPrefix} Handling audio chunk #${this._audioChunkCount}: ${pcmData.length} bytes PCM, playerActive=${this.audioPlayer.isActive()}`);
      }
      
      // Play decoded PCM data (already decoded by client's decoder)
      await this.audioPlayer.play(pcmData);
      
      // Verify player is still active after playing
      if (!this.audioPlayer.isActive() && this._audioChunkCount % 50 === 0) {
        this.logger.warn(`${this.loggerPrefix} Audio player became inactive after playing chunk #${this._audioChunkCount}`);
      }
    } catch (error) {
      this.logger.error(`${this.loggerPrefix} Error playing audio chunk:`, error);
      // If there's an error, try to restart the player
      if (this.currentStreamFormat && this.audioPlayer) {
        this.logger.info(`${this.loggerPrefix} Attempting to restart audio player after error...`);
        try {
          await this.audioPlayer.start(this.currentStreamFormat);
        } catch (restartError) {
          this.logger.error(`${this.loggerPrefix} Failed to restart audio player:`, restartError);
        }
      }
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
    const baseState = {
      status: 'disconnected',
      serverAddress: null,
      currentStreamFormat: null,
      audioStreamActive: false,
      metadata: null
    };
    
    if (this.sendspinPlayer) {
      baseState.status = this.sendspinPlayer.isConnected ? 'connected' : 'disconnected';
      baseState.serverAddress = this.sendspinPlayer.serverAddress || null;
      baseState.currentStreamFormat = this.currentStreamFormat;
      baseState.audioStreamActive = this.audioPlayer && this.audioPlayer.isActive();
      baseState.metadata = this.currentMetadata;
      
      // If we have metadata and are connected, re-push it to Volumio
      // This ensures metadata persists across page refreshes
      if (this.currentMetadata && this.sendspinPlayer.isConnected && this.commandRouter) {
        const hasTitle = this.currentMetadata.title && this.currentMetadata.title !== '';
        const hasArtist = this.currentMetadata.artist && this.currentMetadata.artist !== '';
        
        if (hasTitle || hasArtist) {
          this.logger.info(`${this.loggerPrefix} getState() called - re-pushing metadata to ensure it persists: ${this.currentMetadata.artist || 'Unknown'} - ${this.currentMetadata.title || 'Unknown'}`);
          // Re-push metadata to Volumio so it's available after page refresh
          this.updateNowPlaying(this.currentMetadata);
        }
      }
    }
    
    return baseState;
  }
  
  /**
   * Update Volumio's now playing state with metadata
   * This makes the track info and album art visible in the Volumio UI
   */
  /**
   * Get current playback status for Volumio
   * Maps server playback states to Volumio status values
   */
  getPlaybackStatus() {
    // Map server playback states to Volumio status
    switch (this.currentPlaybackState) {
      case 'playing':
        return 'play';
      case 'paused':
        return 'pause';
      case 'stopped':
      case 'idle':
      default:
        return 'stop';
    }
  }

  /**
   * Handle playback state changes from server
   */
  handlePlaybackStateChange(playbackState) {
    this.currentPlaybackState = playbackState;
    
    // Update Volumio's playback state
    if (this.commandRouter) {
      try {
        const status = this.getPlaybackStatus();
        
        // Note: volumioPlay/volumioPause/volumioStop don't return promises, so use try-catch
        if (status === 'pause' && this.commandRouter.volumioPause) {
          this.logger.info(`${this.loggerPrefix} Pausing Volumio playback`);
          try {
            this.commandRouter.volumioPause();
          } catch (error) {
            this.logger.warn(`${this.loggerPrefix} Error pausing Volumio:`, error);
          }
        } else if (status === 'play' && this.commandRouter.volumioPlay) {
          this.logger.info(`${this.loggerPrefix} Resuming Volumio playback`);
          try {
            this.commandRouter.volumioPlay();
          } catch (error) {
            this.logger.warn(`${this.loggerPrefix} Error resuming Volumio:`, error);
          }
        } else if (status === 'stop' && this.commandRouter.volumioStop) {
          this.logger.info(`${this.loggerPrefix} Stopping Volumio playback`);
          try {
            this.commandRouter.volumioStop();
          } catch (error) {
            this.logger.warn(`${this.loggerPrefix} Error stopping Volumio:`, error);
          }
        }
        
        // Update now playing state to reflect new status
        // Note: Don't stop audio player on pause - MPD will handle pausing the stream
        // The audio player should remain active so chunks can continue to be buffered
        if (this.currentMetadata) {
          this.updateNowPlaying(this.currentMetadata);
        }
      } catch (error) {
        this.logger.error(`${this.loggerPrefix} Error handling playback state change:`, error);
      }
    }
  }

  updateNowPlaying(metadata) {
    this.logger.info(`${this.loggerPrefix} updateNowPlaying called with metadata: ${JSON.stringify(metadata, null, 2)}`);
    
    if (!metadata) {
      this.logger.warn(`${this.loggerPrefix} updateNowPlaying: metadata is null/undefined, returning early`);
      return;
    }
    
    if (!this.commandRouter) {
      this.logger.warn(`${this.loggerPrefix} updateNowPlaying: commandRouter is null/undefined, returning early`);
      return;
    }
    
    try {
      // Get volume/mute from Sendspin client (more reliable than volumioGetState)
      let volume = 100;
      let mute = false;
      if (this.sendspinPlayer) {
        volume = this.sendspinPlayer.config.volume || 100;
        mute = this.sendspinPlayer.config.muted || false;
      }
      
      // Extract metadata fields with detailed logging
      const title = metadata.title || null;
      const artist = metadata.artist || null;
      const album = metadata.album || null;
      let artworkUrl = metadata.artworkUrl || null;
      
      // Validate artwork URL format
      if (artworkUrl) {
        // Check if it's a valid URL format
        try {
          new URL(artworkUrl); // This will throw if invalid
          this.logger.info(`${this.loggerPrefix} updateNowPlaying: Valid artwork URL: "${artworkUrl}"`);
        } catch (error) {
          this.logger.warn(`${this.loggerPrefix} updateNowPlaying: Invalid artwork URL format: "${artworkUrl}", error: ${error.message}`);
          artworkUrl = null; // Don't use invalid URLs
        }
      } else {
        this.logger.info(`${this.loggerPrefix} updateNowPlaying: No artwork URL provided in metadata`);
      }
      
      this.logger.info(`${this.loggerPrefix} updateNowPlaying: title="${title}", artist="${artist}", album="${album}", artworkUrl="${artworkUrl || 'none'}"`);
      
      // Build state update with ALL required fields
      // CRITICAL: All fields must have explicit values (never undefined) to prevent Volumio crashes
      const stateUpdate = {
        service: 'sendspin',
        title: title || 'Unknown Title',
        artist: artist || 'Unknown Artist',
        album: album || '',
        albumart: artworkUrl || '', // Use empty string if no artwork
        uri: 'sendspin://stream',
        type: 'webradio',
        trackType: 'sendspin',
        status: this.getPlaybackStatus(), // Use actual playback status from server
        position: (metadata.progress && metadata.progress.trackProgress) ? metadata.progress.trackProgress : 0,
        duration: (metadata.progress && metadata.progress.trackDuration) ? metadata.progress.trackDuration : 0,
        samplerate: this.currentStreamFormat ? String(this.currentStreamFormat.sample_rate) : '',
        bitdepth: this.currentStreamFormat ? String(this.currentStreamFormat.bit_depth) : '',
        channels: this.currentStreamFormat ? String(this.currentStreamFormat.channels) : '',
        // REQUIRED fields - must be explicit values, never undefined
        volume: Number(volume), // Ensure it's a number
        mute: Boolean(mute)     // Ensure it's a boolean
      };
      
      // Add optional fields only if they have values (to avoid undefined)
      if (metadata.albumArtist) {
        stateUpdate.albumartist = metadata.albumArtist;
      }
      if (metadata.year) {
        stateUpdate.year = Number(metadata.year);
      }
      if (metadata.track) {
        stateUpdate.tracknumber = Number(metadata.track);
      }
      
      // Log the full state update before sending
      this.logger.info(`${this.loggerPrefix} updateNowPlaying: Sending state update to Volumio: ${JSON.stringify(stateUpdate, null, 2)}`);
      
      // Log the full state update before sending (but truncate artwork URL if very long)
      const logStateUpdate = { ...stateUpdate };
      if (logStateUpdate.albumart && logStateUpdate.albumart.length > 100) {
        logStateUpdate.albumart = logStateUpdate.albumart.substring(0, 100) + '...';
      }
      this.logger.info(`${this.loggerPrefix} updateNowPlaying: Sending state update to Volumio: ${JSON.stringify(logStateUpdate, null, 2)}`);
      
      // Update Volumio's state with track info
      // This will display the metadata in the UI
      try {
        this.commandRouter.volumioPushState(stateUpdate);
        this.logger.info(`${this.loggerPrefix} Updated now playing: ${stateUpdate.artist} - ${stateUpdate.title}${stateUpdate.albumart ? ` (artwork: ${stateUpdate.albumart.substring(0, 50)}...)` : ' (no artwork)'}`);
      } catch (error) {
        this.logger.error(`${this.loggerPrefix} Error calling volumioPushState:`, error);
        // Log the state update that failed
        this.logger.error(`${this.loggerPrefix} Failed state update was: ${JSON.stringify(logStateUpdate, null, 2)}`);
      }
    } catch (error) {
      this.logger.error(`${this.loggerPrefix} Error updating now playing state:`, error);
    }
  }

  broadcastState() {
    this.commandRouter.servicePushState('sendspin', this.getState());
  }
}

module.exports = ControllerSendspin;
