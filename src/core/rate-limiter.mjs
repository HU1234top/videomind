/**
 * VideoMind Adaptive Rate Limiter
 *
 * Unlike fixed-delay throttling (e.g. always 6s), this limiter learns from
 * platform responses and adapts:
 * - On consecutive successes -> gradually reduce interval (faster)
 * - On 429/503/CAPTCHA -> aggressively back off (slower)
 * - On transient errors -> moderately increase interval
 * - On slow response (>threshold) -> light increase (avoid future slowdowns)
 *
 * State persists to a JSON file so a resumed run inherits the learned rate
 * instead of starting fresh at `initialInterval`.
 *
 * Design principles (see docs/HANDOVER.md section 7):
 * - Zero cost: no external API, just numbers
 * - Per-platform isolation: Doubao throttling doesn't slow Douyin scraping
 * - Bounded: min/max interval enforced regardless of history
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { createLogger } from './logger.mjs';

export class AdaptiveRateLimiter {
  /**
   * @param {Object} options
   * @param {string} options.platform        - Platform identifier (doubao, douyin, ...)
   * @param {number} options.initialInterval - Starting interval in ms
   * @param {number} options.minInterval     - Lower bound (default 3000ms)
   * @param {number} options.maxInterval     - Upper bound (default 90000ms)
   * @param {number} options.successShrinkAfter - Streak of successes needed to attempt shrink (default 5)
   * @param {number} options.shrinkFactor    - Multiplier on shrink (default 0.9 = 10% faster)
   * @param {number} options.slowResponseMs  - Response time considered "slow" (default 45000ms)
   * @param {string} options.statePath       - Path to persist state (optional)
   */
  constructor(options = {}) {
    this.platform = options.platform || 'unknown';
    this.initialInterval = options.initialInterval || 6000;
    this.minInterval = options.minInterval || 3000;
    this.maxInterval = options.maxInterval || 90000;
    this.successShrinkAfter = options.successShrinkAfter || 5;
    this.shrinkFactor = options.shrinkFactor || 0.9;
    this.slowResponseMs = options.slowResponseMs || 45000;
    this.statePath = options.statePath || null;
    // Optional logger injection (defaults to component-tagged logger)
    this.logger = options.logger || createLogger({ base: { component: 'rate-limiter', platform: this.platform } });

    // Mutable state - restored from disk if available
    this.currentInterval = this.initialInterval;
    this.successStreak = 0;
    this.throttleStreak = 0;
    this.totalSuccess = 0;
    this.totalThrottle = 0;
    this.totalError = 0;
    this.responseTimes = [];           // ring buffer, last 20
    this.lastEvent = null;             // { type, ts, interval }

    if (this.statePath) this.loadState();
  }

  /**
   * Wait for the current interval.
   * @returns {Promise<number>} The actual delay used (ms)
   */
  async delay() {
    const ms = this.currentInterval;
    await new Promise(r => setTimeout(r, ms));
    return ms;
  }

  /**
   * Call after each successful request.
   * @param {number|null} responseMs - How long the request took (for slow detection)
   */
  recordSuccess(responseMs = null) {
    this.totalSuccess++;
    this.successStreak++;
    this.throttleStreak = 0;
    this.lastEvent = { type: 'success', ts: Date.now(), interval: this.currentInterval };

    if (responseMs !== null && responseMs > 0) {
      this.responseTimes.push(responseMs);
      if (this.responseTimes.length > 20) this.responseTimes.shift();

      // Slow response -> light back-off (don't wait for hard throttle)
      if (responseMs > this.slowResponseMs) {
        const newInterval = Math.min(
          this.maxInterval,
          Math.floor(this.currentInterval * 1.25)
        );
        if (newInterval !== this.currentInterval) {
          this.logger.warn(
            { stage: 'rate-limit', event: 'slow_response', responseMs, from: this.currentInterval, to: newInterval },
            'slow response, light back-off'
          );
          this.currentInterval = newInterval;
          this.successStreak = 0;
        }
        this.saveState();
        return;
      }
    }

    // Sustained success -> gradually speed up
    if (this.successStreak >= this.successShrinkAfter) {
      const newInterval = Math.max(
        this.minInterval,
        Math.floor(this.currentInterval * this.shrinkFactor)
      );
      if (newInterval !== this.currentInterval) {
        this.logger.info(
          { stage: 'rate-limit', event: 'shrink', streak: this.successStreak, from: this.currentInterval, to: newInterval },
          'sustained success, shrinking interval'
        );
        this.currentInterval = newInterval;
      }
      this.successStreak = 0;
    }

    this.saveState();
  }

  /**
   * Call when platform signals throttling (429, 503, CAPTCHA, "request too fast").
   * @param {number} severity - 1=moderate, 2=hard, 3=CAPTCHA/block
   * @param {string} signal   - Human-readable reason for logging
   */
  recordThrottle(severity = 1, signal = null) {
    this.totalThrottle++;
    this.throttleStreak++;
    this.successStreak = 0;
    this.lastEvent = { type: 'throttle', ts: Date.now(), interval: this.currentInterval, severity, signal };

    // Escalating multipliers: 1st=2x, 2nd=3x, 3rd+=5x
    const multipliers = [2, 3, 5];
    const baseMult = multipliers[Math.min(this.throttleStreak - 1, 2)];
    const totalMult = baseMult * severity;
    const newInterval = Math.min(
      this.maxInterval,
      Math.floor(this.currentInterval * totalMult)
    );

    this.logger.warn(
      { stage: 'rate-limit', event: 'throttle', severity, signal: signal || 'n/a', streak: this.throttleStreak, from: this.currentInterval, to: newInterval },
      'throttle, escalating back-off'
    );
    this.currentInterval = newInterval;
    this.saveState();
  }

  /**
   * Call on transient errors that aren't platform throttling
   * (network glitches, page parse failures, etc.)
   */
  recordError() {
    this.totalError++;
    this.successStreak = 0;
    this.throttleStreak = 0;
    this.lastEvent = { type: 'error', ts: Date.now(), interval: this.currentInterval };

    const newInterval = Math.min(
      this.maxInterval,
      Math.floor(this.currentInterval * 1.5)
    );
    if (newInterval !== this.currentInterval) {
      this.logger.warn(
        { stage: 'rate-limit', event: 'error', from: this.currentInterval, to: newInterval },
        'transient error, moderate increase'
      );
      this.currentInterval = newInterval;
    }
    this.saveState();
  }

  /**
   * Reset to initial interval (e.g. after a long pause).
   */
  reset() {
    this.currentInterval = this.initialInterval;
    this.successStreak = 0;
    this.throttleStreak = 0;
    this.lastEvent = { type: 'reset', ts: Date.now(), interval: this.currentInterval };
    this.saveState();
  }

  /**
   * Snapshot of current state for observability.
   */
  getStats() {
    const avgResponse = this.responseTimes.length > 0
      ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
      : null;
    return {
      platform: this.platform,
      currentInterval: this.currentInterval,
      minInterval: this.minInterval,
      maxInterval: this.maxInterval,
      successStreak: this.successStreak,
      throttleStreak: this.throttleStreak,
      totalSuccess: this.totalSuccess,
      totalThrottle: this.totalThrottle,
      totalError: this.totalError,
      avgResponseMs: avgResponse !== null ? Math.round(avgResponse) : null,
      lastEvent: this.lastEvent,
    };
  }

  /**
   * Persist current state to disk (best-effort, errors swallowed).
   */
  saveState() {
    if (!this.statePath) return;
    try {
      mkdirSync(dirname(this.statePath), { recursive: true });
      writeFileSync(this.statePath, JSON.stringify({
        platform: this.platform,
        currentInterval: this.currentInterval,
        totalSuccess: this.totalSuccess,
        totalThrottle: this.totalThrottle,
        totalError: this.totalError,
        savedAt: new Date().toISOString(),
      }, null, 2));
    } catch (e) {
      // best-effort persistence
    }
  }

  /**
   * Restore state from disk (best-effort, errors swallowed).
   * @returns {boolean} true if state was loaded
   */
  loadState() {
    if (!this.statePath || !existsSync(this.statePath)) return false;
    try {
      const data = JSON.parse(readFileSync(this.statePath, 'utf8'));
      if (data.currentInterval && data.currentInterval >= this.minInterval) {
        this.currentInterval = data.currentInterval;
        this.totalSuccess = data.totalSuccess || 0;
        this.totalThrottle = data.totalThrottle || 0;
        this.totalError = data.totalError || 0;
        return true;
      }
    } catch (e) {
      // ignore
    }
    return false;
  }
}

// --- Registry of pre-configured limiters per platform ---

const _registry = new Map();

/**
 * Get or create a rate limiter for the given platform.
 * @param {string} platform - doubao, douyin, etc.
 * @param {Object} overrides - Optional overrides for min/max/initial interval
 */
export function getLimiter(platform, overrides = {}) {
  if (!_registry.has(platform)) {
    const defaults = PLATFORM_DEFAULTS[platform] || {};
    _registry.set(platform, new AdaptiveRateLimiter({
      platform,
      ...defaults,
      ...overrides,
    }));
  }
  return _registry.get(platform);
}

/**
 * Reset the global registry (used in tests).
 */
export function _resetRegistry() {
  _registry.clear();
}

/**
 * Pre-configured intervals per platform, tuned from MVP observations.
 *
 * Doubao: chat completion is slow (30-60s) and rate-limit-prone
 *   -> start cautious (6s), max 90s back-off
 * Douyin: comment scraping is lighter but page-load heavy
 *   -> start 5s, max 30s
 */
export const PLATFORM_DEFAULTS = {
  doubao: {
    initialInterval: 6000,
    minInterval: 4000,
    maxInterval: 90000,
    slowResponseMs: 45000,
  },
  douyin: {
    initialInterval: 5000,
    minInterval: 2000,
    maxInterval: 30000,
    slowResponseMs: 20000,
  },
};
