'use strict';

/**
 * Timestamp-based playback scheduler
 * Schedules audio buffers for precise playback timing using clock synchronization
 */
class AudioScheduler {
  constructor(clockSync, bufferMs, logger = console) {
    this.clockSync = clockSync;
    this.logger = logger;
    this.bufferMs = bufferMs;
    
    // Chunk timing (must match server constants)
    this.ChunkDurationMs = 20; // 20ms chunks
    
    // Calculate buffer target (number of chunks to buffer before starting playback)
    this.bufferTarget = Math.max(1, Math.floor(bufferMs / this.ChunkDurationMs));
    
    // Maximum queue size to prevent memory issues on slow machines
    // If queue exceeds this, we'll drop the oldest chunks
    // Set to match bufferMs: 11000ms / 20ms = 550 chunks, but add some headroom
    this.maxQueueSize = Math.min(600, Math.floor(bufferMs / this.ChunkDurationMs) + 50); // ~2MB buffer + headroom
    
    // Priority queue for audio buffers (min-heap by PlayAt time)
    this.bufferQueue = [];
    
    // State
    this.buffering = true; // Start in buffering mode
    this.running = false;
    this.processInterval = null;
    this.watchdogInterval = null;
    
    // Hang detection
    this.bufferStartTime = null; // When buffering started
    this.lastPlayTime = null; // When we last played a buffer
    this.lastReceiveTime = null; // When we last received a chunk
    this.consecutiveDrops = 0; // Count of consecutive dropped chunks
    
    // Statistics
    this.stats = {
      received: 0,
      played: 0,
      dropped: 0
    };
  }

  /**
   * Schedule an audio buffer for playback
   * @param {Buffer} audioData - PCM audio samples
   * @param {number} timestamp - Server timestamp (server loop microseconds)
   */
  schedule(audioData, timestamp) {
    // Update last receive time
    this.lastReceiveTime = Date.now();
    
    // Convert server timestamp to local playback time
    const serverUnixTime = this.clockSync.serverToUnixTime(timestamp);
    const playAt = new Date(serverUnixTime / 1000); // Convert microseconds to milliseconds for Date constructor
    
    // Check if chunk is already too late (before scheduling)
    const now = new Date();
    const delayMs = playAt - now;
    
    const buffer = {
      timestamp: timestamp,
      playAt: playAt,
      samples: audioData
    };
    
    this.stats.received++;
    
    // Log first 10 chunks and then every 50th chunk for debugging
    if (this.stats.received <= 10 || this.stats.received % 50 === 0) {
      const serverNow = this.clockSync.serverMicrosNow();
      const diff = timestamp - serverNow;
      const syncStats = this.clockSync.getStats();
      const queueSize = this.bufferQueue.length;
      
      this.logger.info(`[AudioScheduler] Chunk #${this.stats.received}: ${audioData.length} bytes, timestamp=${timestamp}μs, serverNow=${serverNow}μs, diff=${diff}μs (${(diff / 1000).toFixed(1)}ms), playAt=${playAt.toISOString()}, delay=${delayMs.toFixed(1)}ms, queue=${queueSize}, buffering=${this.buffering}, rtt=${syncStats.rtt}μs, quality=${syncStats.quality}`);
    }
    
    // Check if chunk is already too late before adding to queue
    if (delayMs < -50) {
      // Chunk is more than 50ms late, drop it immediately
      this.stats.dropped++;
      this.consecutiveDrops++;
      if (this.stats.received <= 10) {
        this.logger.warn(`[AudioScheduler] Chunk #${this.stats.received} dropped immediately: ${-delayMs.toFixed(1)}ms late (before queue)`);
      } else {
        this.logger.debug(`[AudioScheduler] Chunk #${this.stats.received} dropped immediately: ${-delayMs.toFixed(1)}ms late`);
      }
      return; // Don't add to queue
    }
    
    // Check if queue is too large (slow machine can't keep up)
    // When queue is full, drop new chunks to prevent unbounded growth
    // The processQueue() method will eventually catch up and play/drop queued chunks
    if (this.bufferQueue.length >= this.maxQueueSize) {
      this.stats.dropped++;
      this.consecutiveDrops++;
      if (this.stats.received % 50 === 0) {
        const syncStats = this.clockSync.getStats();
        this.logger.warn(`[AudioScheduler] Queue full (${this.bufferQueue.length} >= ${this.maxQueueSize}), dropping new chunk #${this.stats.received}. Machine may be too slow. Sync: ${syncStats.quality}, RTT: ${syncStats.rtt}μs`);
      }
      return; // Don't add to queue - let processQueue() catch up
    }
    
    // Add to priority queue
    this.insertBuffer(buffer);
    
    // Log queue size after insertion for first few chunks
    if (this.stats.received <= 10) {
      this.logger.info(`[AudioScheduler] Chunk #${this.stats.received} added to queue: queue size=${this.bufferQueue.length}`);
    }
  }

  /**
   * Insert buffer into priority queue (min-heap by PlayAt time)
   */
  insertBuffer(buffer) {
    this.bufferQueue.push(buffer);
    this.bubbleUp(this.bufferQueue.length - 1);
  }

  /**
   * Bubble up in min-heap
   */
  bubbleUp(index) {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.bufferQueue[parentIndex].playAt <= this.bufferQueue[index].playAt) {
        break;
      }
      [this.bufferQueue[parentIndex], this.bufferQueue[index]] = 
        [this.bufferQueue[index], this.bufferQueue[parentIndex]];
      index = parentIndex;
    }
  }

  /**
   * Bubble down in min-heap
   */
  bubbleDown(index) {
    while (true) {
      let smallest = index;
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      
      if (left < this.bufferQueue.length && 
          this.bufferQueue[left].playAt < this.bufferQueue[smallest].playAt) {
        smallest = left;
      }
      
      if (right < this.bufferQueue.length && 
          this.bufferQueue[right].playAt < this.bufferQueue[smallest].playAt) {
        smallest = right;
      }
      
      if (smallest === index) break;
      
      [this.bufferQueue[index], this.bufferQueue[smallest]] = 
        [this.bufferQueue[smallest], this.bufferQueue[index]];
      index = smallest;
    }
  }

  /**
   * Peek at the next buffer without removing it
   */
  peek() {
    return this.bufferQueue.length > 0 ? this.bufferQueue[0] : null;
  }

  /**
   * Remove and return the next buffer
   */
  pop() {
    if (this.bufferQueue.length === 0) {
      return null;
    }
    
    const top = this.bufferQueue[0];
    const last = this.bufferQueue.pop();
    
    if (this.bufferQueue.length > 0) {
      this.bufferQueue[0] = last;
      this.bubbleDown(0);
    }
    
    return top;
  }

  /**
   * Start the scheduler loop
   * @param {Function} onBufferReady - Callback when buffer is ready to play
   */
  start(onBufferReady) {
    if (this.running) {
      return;
    }
    
    this.running = true;
    this.onBufferReady = onBufferReady;
    this.bufferStartTime = Date.now();
    this.lastPlayTime = null;
    this.lastReceiveTime = null;
    this.consecutiveDrops = 0;
    
    // Process queue every 10ms
    this.processInterval = setInterval(() => {
      this.processQueue();
    }, 10);
    
    // Watchdog: check for hangs every 1 second
    this.watchdogInterval = setInterval(() => {
      this.checkForHang();
    }, 1000);
    
    this.logger.info(`[AudioScheduler] Started scheduler (buffer target: ${this.bufferTarget} chunks)`);
  }

  /**
   * Process the queue and play ready buffers
   */
  processQueue() {
    // Check if we're still buffering at startup
    if (this.buffering) {
      if (this.bufferQueue.length >= this.bufferTarget) {
        this.logger.info(`[AudioScheduler] Startup buffering complete: ${this.bufferQueue.length} chunks ready (target: ${this.bufferTarget})`);
        this.buffering = false;
      } else {
        // Still buffering, don't start playback yet
        // Log every 100ms to show progress
        if (this.bufferQueue.length > 0 && this.stats.received % 5 === 0) {
          this.logger.debug(`[AudioScheduler] Buffering: ${this.bufferQueue.length}/${this.bufferTarget} chunks`);
        }
        return;
      }
    }
    
    const now = new Date();
    let buffersPlayed = 0;
    
    while (this.bufferQueue.length > 0) {
      const buffer = this.peek();
      if (!buffer) break;
      
      const delay = buffer.playAt - now;
      const delayMs = delay;
      
      if (delayMs > 50) {
        // Too early (>50ms), wait
        break;
      } else if (delayMs < -50) {
        // Too late (>50ms late), drop
        this.pop();
        this.stats.dropped++;
        this.consecutiveDrops++;
        
        // Log warning if we're dropping many consecutive chunks
        if (this.consecutiveDrops === 10 || (this.consecutiveDrops > 10 && this.consecutiveDrops % 10 === 0)) {
          const syncStats = this.clockSync.getStats();
          this.logger.warn(`[AudioScheduler] Dropped ${this.consecutiveDrops} consecutive late buffers (last: ${-delayMs.toFixed(1)}ms late). Clock sync quality: ${syncStats.quality}, rtt: ${syncStats.rtt}μs`);
        } else {
          this.logger.debug(`[AudioScheduler] Dropped late buffer: ${-delayMs.toFixed(1)}ms late`);
        }
      } else {
        // Ready to play (within ±50ms window)
        const readyBuffer = this.pop();
        this.stats.played++;
        this.lastPlayTime = Date.now();
        this.consecutiveDrops = 0; // Reset drop counter when we successfully play
        
        // Log first few buffers and then periodically
        if (this.stats.played <= 5 || this.stats.played % 50 === 0) {
          this.logger.info(`[AudioScheduler] Playing buffer #${this.stats.played}: ${readyBuffer.samples.length} bytes, ${delayMs > 0 ? `${delayMs.toFixed(1)}ms early` : `${-delayMs.toFixed(1)}ms late`}, queue=${this.bufferQueue.length}`);
        }
        
        if (this.onBufferReady) {
          this.onBufferReady(readyBuffer.samples);
          buffersPlayed++;
        } else {
          this.logger.warn('[AudioScheduler] Buffer ready but no callback registered!');
        }
      }
    }
    
    // Log if we're not getting any buffers
    if (this.bufferQueue.length === 0 && !this.buffering && this.stats.received > 0 && buffersPlayed === 0) {
      // Only log this occasionally to avoid spam
      if (this.stats.played % 100 === 0 || this.stats.played === 0) {
        this.logger.debug(`[AudioScheduler] Queue empty, waiting for more chunks (received: ${this.stats.received}, played: ${this.stats.played})`);
      }
    }
  }

  /**
   * Check for hung state and recover if needed
   */
  checkForHang() {
    if (!this.running) {
      return;
    }
    
    const now = Date.now();
    const syncStats = this.clockSync.getStats();
    
    // 1. Check if buffering is taking too long (>5 seconds)
    if (this.buffering && this.bufferStartTime) {
      const bufferingDuration = now - this.bufferStartTime;
      if (bufferingDuration > 5000) {
        this.logger.warn(`[AudioScheduler] HANG DETECTED: Buffering for ${(bufferingDuration/1000).toFixed(1)}s (target: ${this.bufferTarget}, have: ${this.bufferQueue.length}). Forcing playback start.`);
        this.buffering = false; // Force start playback
        this.bufferStartTime = null;
      }
    }
    
    // 2. Check if we're receiving chunks but not playing them (>3 seconds)
    if (!this.buffering && this.lastReceiveTime && this.lastPlayTime) {
      const timeSinceReceive = now - this.lastReceiveTime;
      const timeSincePlay = now - this.lastPlayTime;
      
      if (timeSinceReceive < 2000 && timeSincePlay > 3000) {
        // Receiving chunks but haven't played in 3+ seconds
        this.logger.warn(`[AudioScheduler] HANG DETECTED: Receiving chunks but not playing (last play: ${(timeSincePlay/1000).toFixed(1)}s ago, queue: ${this.bufferQueue.length}, dropped: ${this.stats.dropped}, sync: ${syncStats.quality}). Attempting recovery.`);
        this.attemptRecovery();
      }
    } else if (!this.buffering && this.lastReceiveTime && !this.lastPlayTime && (now - this.lastReceiveTime) > 3000) {
      // Never played anything but receiving chunks for 3+ seconds
      this.logger.warn(`[AudioScheduler] HANG DETECTED: Receiving chunks but never played (queue: ${this.bufferQueue.length}, dropped: ${this.stats.dropped}, sync: ${syncStats.quality}). Attempting recovery.`);
      this.attemptRecovery();
    }
    
    // 3. Check if clock sync is lost and we're dropping chunks
    if (syncStats.quality === 'lost' && this.consecutiveDrops > 20) {
      this.logger.warn(`[AudioScheduler] HANG DETECTED: Clock sync lost and ${this.consecutiveDrops} consecutive drops. Attempting recovery.`);
      this.attemptRecovery();
    }
    
    // 4. Check if we have a large queue but nothing is playing (>5 seconds)
    if (!this.buffering && this.bufferQueue.length > 10 && this.lastPlayTime && (now - this.lastPlayTime) > 5000) {
      this.logger.warn(`[AudioScheduler] HANG DETECTED: Large queue (${this.bufferQueue.length}) but no playback for ${((now - this.lastPlayTime)/1000).toFixed(1)}s. Attempting recovery.`);
      this.attemptRecovery();
    }
  }
  
  /**
   * Attempt to recover from a hung state
   */
  attemptRecovery() {
    const syncStats = this.clockSync.getStats();
    this.logger.warn(`[AudioScheduler] RECOVERY: Clearing queue (${this.bufferQueue.length} buffers), resetting buffering, sync quality: ${syncStats.quality}`);
    
    // Clear the queue
    const droppedCount = this.bufferQueue.length;
    this.bufferQueue = [];
    this.stats.dropped += droppedCount;
    
    // Reset buffering state
    this.buffering = true;
    this.bufferStartTime = Date.now();
    this.consecutiveDrops = 0;
    
    // If clock sync is lost, log a warning (we can't fix it here, but the client should handle it)
    if (syncStats.quality === 'lost') {
      this.logger.error(`[AudioScheduler] RECOVERY: Clock sync is LOST. Client should re-sync clock.`);
    }
    
    this.logger.info(`[AudioScheduler] RECOVERY: Reset complete. Waiting for new chunks to buffer.`);
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
    
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
    
    this.running = false;
    this.bufferQueue = [];
    this.buffering = true;
    this.bufferStartTime = null;
    this.lastPlayTime = null;
    this.lastReceiveTime = null;
    this.consecutiveDrops = 0;
    
    this.logger.info('[AudioScheduler] Stopped scheduler');
  }

  /**
   * Clear all buffered audio (used for seek operations)
   */
  clear() {
    this.bufferQueue = [];
    this.buffering = true;
    this.logger.info('[AudioScheduler] Buffers cleared, re-entering buffering mode');
  }

  /**
   * Get scheduler statistics
   */
  getStats() {
    return {
      received: this.stats.received,
      played: this.stats.played,
      dropped: this.stats.dropped
    };
  }

  /**
   * Get current buffer depth in milliseconds
   */
  getBufferDepth() {
    return this.bufferQueue.length * this.ChunkDurationMs;
  }
}

module.exports = AudioScheduler;

