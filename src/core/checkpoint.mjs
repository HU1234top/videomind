/**
 * VideoMind Checkpoint — SQLite-backed task state for resume-on-failure
 *
 * Phase A Task 1: Without this, an interruption mid-analysis (Chrome crash,
 * CAPTCHA, Ctrl+C, power loss) loses ALL work. With this, the next run
 * picks up exactly where the previous one left off.
 *
 * Design:
 * - One row per video URL (URL is the natural primary key)
 * - Status state machine: pending -> in_progress -> completed | failed
 * - Failed tasks can be retried (attempts counter)
 * - All writes are synchronous (better-sqlite3 is sync by default — fits
 *   our sequential analysis loop perfectly)
 * - DB file path is configurable (default: ./output/.videomind-checkpoint.db)
 *
 * Important: this is NOT an output format. The structured_knowledge_base.json
 * stays as the canonical output. This DB is purely a side-store for resumability.
 */

import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { createRequire } from 'module';

// better-sqlite3 is loaded lazily to avoid forcing the dep if user doesn't use checkpoints
// Use createRequire since this is ESM and we need sync loading
const require = createRequire(import.meta.url);

let Database = null;

function loadBetterSqlite3() {
  if (Database === null) {
    try {
      Database = require('better-sqlite3');
    } catch (e) {
      throw new Error(
        'better-sqlite3 is not installed. Run `npm install better-sqlite3` to use checkpoints. ' +
        'Or pass enabled: false in Checkpoint options to disable.'
      );
    }
  }
  return Database;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS analysis_tasks (
  url TEXT PRIMARY KEY,
  title TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')),
  result TEXT,
  error TEXT,
  attempts INTEGER DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_status ON analysis_tasks(status);
`;

export class Checkpoint {
  /**
   * @param {Object} options
   * @param {string} options.dbPath - Path to SQLite file (default: ./output/.videomind-checkpoint.db)
   * @param {boolean} options.enabled - Enable/disable (default: true). When false, all methods are no-ops.
   * @param {number} options.maxRetries - Max attempts before giving up (default: 3)
   */
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.dbPath = options.dbPath || './output/.videomind-checkpoint.db';
    this.maxRetries = options.maxRetries || 3;
    this.db = null;

    if (!this.enabled) return;

    const DbClass = loadBetterSqlite3();
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new DbClass(this.dbPath);
    this.db.pragma('journal_mode = WAL'); // better concurrency
    this.db.exec(SCHEMA);

    // Prepared statements (faster than re-parsing)
    this._stmt = {
      register: this.db.prepare(`
        INSERT INTO analysis_tasks (url, title, status, updated_at)
        VALUES (?, ?, 'pending', ?)
        ON CONFLICT(url) DO NOTHING
      `),
      getStatus: this.db.prepare(`
        SELECT status, attempts FROM analysis_tasks WHERE url = ?
      `),
      markInProgress: this.db.prepare(`
        UPDATE analysis_tasks
        SET status = 'in_progress', attempts = attempts + 1, started_at = ?, updated_at = ?
        WHERE url = ?
      `),
      markCompleted: this.db.prepare(`
        UPDATE analysis_tasks
        SET status = 'completed', result = ?, completed_at = ?, error = NULL, updated_at = ?
        WHERE url = ?
      `),
      markFailed: this.db.prepare(`
        UPDATE analysis_tasks
        SET status = 'failed', error = ?, updated_at = ?
        WHERE url = ?
      `),
      resetFailed: this.db.prepare(`
        UPDATE analysis_tasks
        SET status = 'pending', error = NULL, updated_at = ?
        WHERE url = ?
      `),
      getPending: this.db.prepare(`
        SELECT url, title FROM analysis_tasks
        WHERE status IN ('pending', 'failed')
        ORDER BY updated_at ASC
      `),
      getStats: this.db.prepare(`
        SELECT status, COUNT(*) as count FROM analysis_tasks GROUP BY status
      `),
      getTotal: this.db.prepare(`
        SELECT COUNT(*) as count FROM analysis_tasks
      `),
      clear: this.db.prepare(`
        DELETE FROM analysis_tasks
      `),
      getCompletedResults: this.db.prepare(`
        SELECT url, result FROM analysis_tasks
        WHERE status = 'completed' AND result IS NOT NULL
        ORDER BY completed_at ASC
      `),
    };
  }

  /**
   * Register a batch of videos. Idempotent — existing rows are kept as-is.
   * @param {Array<{url, title}>} videos
   * @returns {number} Count of newly registered videos
   */
  registerBatch(videos) {
    if (!this.enabled) return 0;
    const now = new Date().toISOString();
    const tx = this.db.transaction((vids) => {
      let count = 0;
      for (const v of vids) {
        const result = this._stmt.register.run(v.url, v.title || '', now);
        if (result.changes > 0) count++;
      }
      return count;
    });
    return tx(videos);
  }

  /**
   * Check if a video is already completed (and thus can be skipped).
   * @param {string} url
   * @returns {boolean}
   */
  isCompleted(url) {
    if (!this.enabled) return false;
    const row = this._stmt.getStatus.get(url);
    return row?.status === 'completed';
  }

  /**
   * Get the cached analysis result for a completed URL.
   * @param {string} url
   * @returns {Object|null}
   */
  getCachedResult(url) {
    if (!this.enabled) return null;
    const row = this.db.prepare(`SELECT result FROM analysis_tasks WHERE url = ? AND status = 'completed'`).get(url);
    if (!row?.result) return null;
    try {
      return JSON.parse(row.result);
    } catch {
      return null;
    }
  }

  /**
   * Mark a video as in_progress (called before starting analysis).
   * Increments attempts counter.
   * @param {string} url
   * @returns {boolean} true if accepted, false if max retries exceeded
   */
  markInProgress(url) {
    if (!this.enabled) return true;
    const row = this._stmt.getStatus.get(url);
    const attempts = (row?.attempts || 0) + 1;
    if (attempts > this.maxRetries) {
      return false;
    }
    const now = new Date().toISOString();
    this._stmt.markInProgress.run(now, now, url);
    return true;
  }

  /**
   * Mark a video as completed with the analysis result.
   * @param {string} url
   * @param {Object} result - Analysis result object
   */
  markCompleted(url, result) {
    if (!this.enabled) return;
    const now = new Date().toISOString();
    this._stmt.markCompleted.run(JSON.stringify(result), now, now, url);
  }

  /**
   * Mark a video as failed (error message stored for debugging).
   * @param {string} url
   * @param {string} error - Error message
   */
  markFailed(url, error) {
    if (!this.enabled) return;
    const now = new Date().toISOString();
    this._stmt.markFailed.run(error || 'unknown error', now, url);
  }

  /**
   * Reset a failed video back to pending (for manual retry).
   * @param {string} url
   */
  resetFailed(url) {
    if (!this.enabled) return;
    const now = new Date().toISOString();
    this._stmt.resetFailed.run(now, url);
  }

  /**
   * Get all videos still needing work (pending + failed-but-retryable).
   * @returns {Array<{url, title}>}
   */
  getPending() {
    if (!this.enabled) return [];
    return this._stmt.getPending.all();
  }

  /**
   * Get counts by status.
   * @returns {{total: number, pending: number, in_progress: number, completed: number, failed: number}}
   */
  getStats() {
    if (!this.enabled) return { total: 0, pending: 0, in_progress: 0, completed: 0, failed: 0, enabled: false };
    const rows = this._stmt.getStats.all();
    const stats = { total: 0, pending: 0, in_progress: 0, completed: 0, failed: 0, enabled: true };
    for (const row of rows) {
      stats[row.status] = row.count;
      stats.total += row.count;
    }
    return stats;
  }

  /**
   * Get all completed results (for building the final KB from cached state).
   * @returns {Array<Object>} Analysis results in completion order
   */
  getCompletedResults() {
    if (!this.enabled) return [];
    const rows = this._stmt.getCompletedResults.all();
    return rows.map(r => {
      try {
        return JSON.parse(r.result);
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  /**
   * Clear all checkpoint state. Useful for re-running from scratch.
   */
  clear() {
    if (!this.enabled) return;
    this._stmt.clear.run();
  }

  /**
   * Close the database connection. Always call this on shutdown.
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

/**
 * Convenience factory: parse CLI args and return a Checkpoint config.
 */
export function checkpointConfigFromArgs(args) {
  const getArg = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };
  // --no-checkpoint is a boolean flag (no value follows), check presence directly
  const enabled = !args.includes('--no-checkpoint');
  const dbPath = getArg('--checkpoint-db');
  return { enabled, dbPath };
}
