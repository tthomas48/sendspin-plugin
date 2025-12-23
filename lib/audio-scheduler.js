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
    
    // Priority queue for audio buffers (min-heap by PlayAt time)
    this.bufferQueue = [];
    
    // State
    this.buffering = true; // Start in buffering mode
    this.running = false;
    this.processInterval = null;
    
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
    // Convert server timestamp to local playback time
    const serverUnixTime = this.clockSync.serverToUnixTime(timestamp);
    const playAt = new Date(serverUnixTime / 1000); // Convert microseconds to milliseconds for Date constructor
    
    const buffer = {
      timestamp: timestamp,
      playAt: playAt,
      samples: audioData
    };
    
    this.stats.received++;
    
    // Log first 5 chunks for debugging
    if (this.stats.received <= 5) {
      const serverNow = this.clockSync.serverMicrosNow();
      const diff = timestamp - serverNow;
      const syncStats = this.clockSync.getStats();
      
      this.logger.info(`[AudioScheduler] Chunk #${this.stats.received}: timestamp=${timestamp}μs, serverNow=${serverNow}μs, diff=${diff}μs (${(diff / 1000).toFixed(1)}ms), rtt=${syncStats.rtt}μs, quality=${syncStats.quality}`);
    }
    
    // Add to priority queue
    this.insertBuffer(buffer);
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
    
    // Process queue every 10ms
    this.processInterval = setInterval(() => {
      this.processQueue();
    }, 10);
    
    this.logger.info(`[AudioScheduler] Started scheduler (buffer target: ${this.bufferTarget} chunks)`);
  }

  /**
   * Process the queue and play ready buffers
   */
  processQueue() {
    // Check if we're still buffering at startup
    if (this.buffering) {
      if (this.bufferQueue.length >= this.bufferTarget) {
        this.logger.info(`[AudioScheduler] Startup buffering complete: ${this.bufferQueue.length} chunks ready`);
        this.buffering = false;
      } else {
        // Still buffering, don't start playback yet
        return;
      }
    }
    
    const now = new Date();
    
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
        this.logger.warn(`[AudioScheduler] Dropped late buffer: ${-delayMs.toFixed(1)}ms late`);
      } else {
        // Ready to play (within ±50ms window)
        const readyBuffer = this.pop();
        this.stats.played++;
        
        if (this.onBufferReady) {
          this.onBufferReady(readyBuffer.samples);
        }
      }
    }
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
    
    this.running = false;
    this.bufferQueue = [];
    this.buffering = true;
    
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

