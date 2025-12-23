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
      const nowUnix = Number(process.hrtime.bigint() / 1000n);
      this.serverLoopStartUnix = nowUnix - t2;
      this.synced = true;
      this.quality = 'good';
      this.sampleCount++;
      this.logger.info(`[ClockSync] Clock sync established: serverLoopStart=${this.serverLoopStartUnix}, rtt=${rtt}μs`);
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
    // If we haven't synced yet, assume server time = client time
    if (!this.synced) {
      return Number(process.hrtime.bigint() / 1000n);
    }

    // Convert server loop µs to Unix µs
    return this.serverLoopStartUnix + serverTime;
  }

  /**
   * Get current time in server's reference frame (server loop microseconds)
   * @returns {number} Server loop time in microseconds
   */
  serverMicrosNow() {
    if (!this.synced) {
      // Before sync, return Unix time (approximation)
      return Number(process.hrtime.bigint() / 1000n);
    }

    // Convert current Unix time to server loop time
    const nowUnix = Number(process.hrtime.bigint() / 1000n);
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

