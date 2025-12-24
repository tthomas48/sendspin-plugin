'use strict';

/**
 * Clock synchronization with server
 * Tracks server loop origin and RTT for synchronized audio playback
 */
class ClockSync {
  constructor(logger = console) {
    this.logger = logger;
    this.serverLoopStartUnix = null; // Unix microseconds when server loop started
    this.rtt = 0; // Latest round-trip time in microseconds
    this.quality = 'lost'; // 'good', 'degraded', or 'lost'
    this.lastSync = null; // Date of last successful sync
    this.sampleCount = 0;
    this.synced = false; // True after first successful sync
  }

  /**
   * Process a server/time response
   * @param {number} t1 - Client send time (Unix microseconds)
   * @param {number} t2 - Server receive time (server loop microseconds)
   * @param {number} t3 - Server send time (server loop microseconds)
   * @param {number} t4 - Client receive time (Unix microseconds)
   */
  processSyncResponse(t1, t2, t3, t4) {
    // Calculate RTT: (total round-trip) - (server processing time)
    const rtt = (t4 - t1) - (t3 - t2);

    this.rtt = rtt;
    this.lastSync = new Date();

    // Discard samples with high RTT (network congestion)
    if (rtt > 100000) { // 100ms
      this.logger.debug(`[ClockSync] Discarding sync sample: high RTT ${rtt}μs`);
      return;
    }

    // On first successful sync, compute when the server loop started in Unix µs
    // t2 is server_received (server loop µs), t4 is our Unix µs
    if (!this.synced) {
      // Use Date.now() * 1000 to get Unix microseconds (not process.hrtime which is monotonic)
      const nowUnix = Date.now() * 1000;
      this.serverLoopStartUnix = nowUnix - t2;
      this.synced = true;
      this.quality = 'good';
      this.sampleCount++;
      this.logger.info(`[ClockSync] Clock sync established: serverLoopStart=${this.serverLoopStartUnix}, nowUnix=${nowUnix}, t2=${t2}, rtt=${rtt}μs`);
      return;
    }

    // Update quality based on RTT
    if (rtt < 50000) { // <50ms
      this.quality = 'good';
    } else {
      this.quality = 'degraded';
    }

    this.sampleCount++;

    if (this.sampleCount < 10) {
      this.logger.debug(`[ClockSync] Sync #${this.sampleCount}: rtt=${rtt}μs, quality=${this.quality}`);
    }
  }

  /**
   * Get sync statistics
   * @returns {{rtt: number, quality: string}}
   */
  getStats() {
    // Check if sync is stale (>5 seconds since last sync)
    if (this.lastSync) {
      const timeSinceSync = Date.now() - this.lastSync.getTime();
      if (timeSinceSync > 5000) {
        this.quality = 'lost';
      }
    }

    return {
      rtt: this.rtt,
      quality: this.quality
    };
  }

  /**
   * Convert server timestamp (loop microseconds) to Unix microseconds
   * @param {number} serverTime - Server loop time in microseconds
   * @returns {number} Unix microseconds
   */
  serverToUnixTime(serverTime) {
    // Check if sync is still valid
    const stats = this.getStats();
    if (stats.quality === 'lost') {
      // Clock sync is lost - don't use broken conversion
      // Instead, estimate based on current time and assume chunks are ~500ms in the future
      const nowUnix = Date.now() * 1000; // Unix microseconds
      const estimatedPlayTime = nowUnix + 500000; // 500ms in the future
      
      // Only log this occasionally to avoid spam (every 100 chunks or first 5)
      if (!this._syncLostWarningCount) this._syncLostWarningCount = 0;
      this._syncLostWarningCount++;
      if (this._syncLostWarningCount <= 5 || this._syncLostWarningCount % 100 === 0) {
        this.logger.warn(`[ClockSync] Sync LOST - using estimated time: serverTime=${serverTime}μs -> estimated=${estimatedPlayTime}μs (now=${nowUnix}μs) (warning #${this._syncLostWarningCount})`);
      }
      return estimatedPlayTime;
    }
    
    // If we haven't synced yet, assume server time = client time
    if (!this.synced) {
      const nowUnix = Date.now() * 1000; // Unix microseconds
      this.logger.warn(`[ClockSync] Converting server time without sync! serverTime=${serverTime}μs, using now=${nowUnix}μs`);
      return nowUnix;
    }

    // Convert server loop µs to Unix µs
    const unixTime = this.serverLoopStartUnix + serverTime;
    
    // Validate conversion - if it's clearly wrong (more than 1 hour off), something is broken
    const nowUnix = Date.now() * 1000; // Unix microseconds
    const diff = unixTime - nowUnix;
    if (Math.abs(diff) > 3600000000) { // >1 hour difference
      this.logger.error(`[ClockSync] BROKEN conversion detected: serverTime=${serverTime}μs -> unixTime=${unixTime}μs, now=${nowUnix}μs, diff=${diff}μs (${(diff/1000000).toFixed(1)}s), serverLoopStart=${this.serverLoopStartUnix}. Using estimated time instead.`);
      // Use estimated time instead
      return nowUnix + 500000; // 500ms in the future
    }
    
    return unixTime;
  }

  /**
   * Get current time in server's reference frame (server loop microseconds)
   * @returns {number} Server loop time in microseconds
   */
  serverMicrosNow() {
    if (!this.synced) {
      // Before sync, return Unix time (approximation)
      return Date.now() * 1000; // Unix microseconds
    }

    // Convert current Unix time to server loop time
    const nowUnix = Date.now() * 1000; // Unix microseconds
    return nowUnix - this.serverLoopStartUnix;
  }

  /**
   * Check if clock is synchronized
   * @returns {boolean}
   */
  isSynced() {
    return this.synced;
  }
}

module.exports = ClockSync;

