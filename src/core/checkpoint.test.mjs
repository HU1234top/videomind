/**
 * VideoMind Unit Tests — Checkpoint (SQLite-backed task state)
 *
 * These tests require better-sqlite3. If not installed, they'll be skipped
 * with a helpful message instead of failing.
 *
 * Coverage:
 * - Schema initialization
 * - Bulk registration (idempotent)
 * - Status transitions (pending → in_progress → completed/failed)
 * - Resume detection (isCompleted, getPending)
 * - Cached result retrieval (getCachedResult)
 * - Stats and reporting
 * - Retry limits
 * - Disabled mode (no-op passthrough)
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Check if better-sqlite3 is available
let betterSqliteAvailable = false;
try {
  require('better-sqlite3');
  betterSqliteAvailable = true;
} catch {
  betterSqliteAvailable = false;
}

const skipIfNoSqlite = betterSqliteAvailable ? describe : describe.skip;

// Use dynamic import only when available
let Checkpoint;
async function loadCheckpoint() {
  if (!Checkpoint) {
    const mod = await import('./checkpoint.mjs');
    Checkpoint = mod.Checkpoint;
  }
  return Checkpoint;
}

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'videomind-checkpoint-'));
});

after(() => {
  // Best-effort cleanup
});

skipIfNoSqlite('Checkpoint — schema and initialization', () => {
  it('creates DB file on construction', async () => {
    const Ckp = await loadCheckpoint();
    const dbPath = join(tmpDir, 'test.db');
    const cp = new Ckp({ dbPath });
    assert.ok(existsSync(dbPath), 'DB file should be created');
    cp.close();
  });

  it('reopens existing DB without losing data', async () => {
    const Ckp = await loadCheckpoint();
    const dbPath = join(tmpDir, 'test.db');
    const cp1 = new Ckp({ dbPath });
    cp1.registerBatch([{ url: 'u1', title: 'T1' }]);
    cp1.markInProgress('u1');
    cp1.markCompleted('u1', { result: 'done' });
    cp1.close();

    const cp2 = new Ckp({ dbPath });
    assert.ok(cp2.isCompleted('u1'));
    cp2.close();
  });

  it('idempotent: re-registering does not overwrite', async () => {
    const Ckp = await loadCheckpoint();
    const cp = new Ckp({ dbPath: join(tmpDir, 'test.db') });
    cp.registerBatch([{ url: 'u1', title: 'Original' }]);
    cp.markCompleted('u1', { data: 'first' });

    cp.registerBatch([{ url: 'u1', title: 'Different' }]);
    const result = cp.getCachedResult('u1');
    assert.deepEqual(result, { data: 'first' });
    cp.close();
  });
});

skipIfNoSqlite('Checkpoint — registerBatch', () => {
  it('returns count of newly registered (not pre-existing)', async () => {
    const Ckp = await loadCheckpoint();
    const cp = new Ckp({ dbPath: join(tmpDir, 'test.db') });
    const count1 = cp.registerBatch([
      { url: 'u1', title: 'T1' },
      { url: 'u2', title: 'T2' },
    ]);
    assert.equal(count1, 2);

    const count2 = cp.registerBatch([
      { url: 'u1', title: 'T1' }, // already exists
      { url: 'u3', title: 'T3' }, // new
    ]);
    assert.equal(count2, 1, 'only u3 should be newly registered');
    cp.close();
  });

  it('handles empty batch', async () => {
    const Ckp = await loadCheckpoint();
    const cp = new Ckp({ dbPath: join(tmpDir, 'test.db') });
    assert.equal(cp.registerBatch([]), 0);
    cp.close();
  });
});

skipIfNoSqlite('Checkpoint — status transitions', () => {
  it('pending → in_progress → completed flow', async () => {
    const Ckp = await loadCheckpoint();
    const cp = new Ckp({ dbPath: join(tmpDir, 'test.db') });
    cp.registerBatch([{ url: 'u1', title: 'T1' }]);

    assert.ok(!cp.isCompleted('u1'), 'freshly registered is not completed');

    cp.markInProgress('u1');
    const stats1 = cp.getStats();
    assert.equal(stats1.in_progress, 1);

    cp.markCompleted('u1', { analysis: 'done' });
    assert.ok(cp.isCompleted('u1'));

    const stats2 = cp.getStats();
    assert.equal(stats2.completed, 1);
    assert.equal(stats2.in_progress, 0);
    cp.close();
  });

  it('pending → in_progress → failed flow', async () => {
    const Ckp = await loadCheckpoint();
    const cp = new Ckp({ dbPath: join(tmpDir, 'test.db'), maxRetries: 3 });
    cp.registerBatch([{ url: 'u1', title: 'T1' }]);
    cp.markInProgress('u1');
    cp.markFailed('u1', 'CAPTCHA detected');

    const stats = cp.getStats();
    assert.equal(stats.failed, 1);
    assert.ok(!cp.isCompleted('u1'), 'failed is not completed');
    cp.close();
  });

  it('markInProgress increments attempts', async () => {
    const Ckp = await loadCheckpoint();
    const cp = new Ckp({ dbPath: join(tmpDir, 'test.db'), maxRetries: 3 });
    cp.registerBatch([{ url: 'u1', title: 'T1' }]);
    cp.markInProgress('u1');
    cp.markInProgress('u1');
    cp.markInProgress('u1');
    // 4th attempt should be rejected
    const accepted = cp.markInProgress('u1');
    assert.equal(accepted, false, 'should reject after maxRetries');
    cp.close();
  });

  it('resetFailed moves failed → pending', async () => {
    const Ckp = await loadCheckpoint();
    const cp = new Ckp({ dbPath: join(tmpDir, 'test.db'), maxRetries: 3 });
    cp.registerBatch([{ url: 'u1', title: 'T1' }]);
    cp.markInProgress('u1');
    cp.markFailed('u1', 'err');

    cp.resetFailed('u1');
    const stats = cp.getStats();
    assert.equal(stats.failed, 0);
    assert.equal(stats.pending, 1);
    cp.close();
  });
});

skipIfNoSqlite('Checkpoint — resume detection', () => {
  it('getPending returns only pending + retryable failed', async () => {
    const Ckp = await loadCheckpoint();
    const cp = new Ckp({ dbPath: join(tmpDir, 'test.db'), maxRetries: 3 });
    cp.registerBatch([
      { url: 'u1', title: 'Pending' },
      { url: 'u2', title: 'In Progress' },
      { url: 'u3', title: 'Completed' },
      { url: 'u4', title: 'Failed' },
    ]);
    cp.markInProgress('u2');
    cp.markCompleted('u3', { x: 1 });
    cp.markInProgress('u4');
    cp.markFailed('u4', 'err');

    const pending = cp.getPending();
    const urls = pending.map(p => p.url).sort();
    assert.deepEqual(urls, ['u1', 'u4']);
    cp.close();
  });

  it('getCachedResult returns parsed JSON for completed', async () => {
    const Ckp = await loadCheckpoint();
    const cp = new Ckp({ dbPath: join(tmpDir, 'test.db') });
    cp.registerBatch([{ url: 'u1', title: 'T1' }]);
    cp.markInProgress('u1');
    cp.markCompleted('u1', { analysis: 'hello', dimensions: { skill_name: 'X' } });

    const result = cp.getCachedResult('u1');
    assert.deepEqual(result, { analysis: 'hello', dimensions: { skill_name: 'X' } });
    cp.close();
  });

  it('getCachedResult returns null for non-completed', async () => {
    const Ckp = await loadCheckpoint();
    const cp = new Ckp({ dbPath: join(tmpDir, 'test.db') });
    cp.registerBatch([{ url: 'u1', title: 'T1' }]);
    assert.equal(cp.getCachedResult('u1'), null);
    cp.close();
  });

  it('getCompletedResults returns all completed analyses', async () => {
    const Ckp = await loadCheckpoint();
    const cp = new Ckp({ dbPath: join(tmpDir, 'test.db') });
    cp.registerBatch([
      { url: 'u1', title: 'T1' },
      { url: 'u2', title: 'T2' },
      { url: 'u3', title: 'T3' },
    ]);
    cp.markInProgress('u1'); cp.markCompleted('u1', { url: 'u1', result: 1 });
    cp.markInProgress('u3'); cp.markCompleted('u3', { url: 'u3', result: 3 });

    const results = cp.getCompletedResults();
    assert.equal(results.length, 2);
    assert.ok(results.some(r => r.url === 'u1'));
    assert.ok(results.some(r => r.url === 'u3'));
    cp.close();
  });
});

skipIfNoSqlite('Checkpoint — getStats', () => {
  it('returns counts by status', async () => {
    const Ckp = await loadCheckpoint();
    const cp = new Ckp({ dbPath: join(tmpDir, 'test.db'), maxRetries: 3 });
    cp.registerBatch([
      { url: 'a', title: 'A' },
      { url: 'b', title: 'B' },
      { url: 'c', title: 'C' },
    ]);
    cp.markInProgress('a');
    cp.markInProgress('b'); cp.markCompleted('b', { ok: true });
    cp.markInProgress('c'); cp.markFailed('c', 'err');

    const stats = cp.getStats();
    assert.equal(stats.total, 3);
    assert.equal(stats.in_progress, 1);
    assert.equal(stats.completed, 1);
    assert.equal(stats.failed, 1);
    assert.equal(stats.pending, 0);
    cp.close();
  });

  it('returns all zeros for empty DB', async () => {
    const Ckp = await loadCheckpoint();
    const cp = new Ckp({ dbPath: join(tmpDir, 'test.db') });
    const stats = cp.getStats();
    assert.equal(stats.total, 0);
    cp.close();
  });
});

skipIfNoSqlite('Checkpoint — clear', () => {
  it('removes all rows', async () => {
    const Ckp = await loadCheckpoint();
    const cp = new Ckp({ dbPath: join(tmpDir, 'test.db') });
    cp.registerBatch([{ url: 'a', title: 'A' }, { url: 'b', title: 'B' }]);
    cp.markCompleted('a', { x: 1 });
    cp.markCompleted('b', { x: 2 });
    assert.equal(cp.getStats().total, 2);

    cp.clear();
    assert.equal(cp.getStats().total, 0);
    cp.close();
  });
});

describe('Checkpoint — disabled mode', () => {
  it('all methods are no-ops when enabled=false', async () => {
    const Ckp = await loadCheckpoint();
    const cp = new Ckp({ enabled: false });
    cp.registerBatch([{ url: 'u1', title: 'T1' }]);
    cp.markInProgress('u1');
    cp.markCompleted('u1', { x: 1 });
    cp.markFailed('u1', 'err');
    cp.resetFailed('u1');
    cp.clear();

    assert.equal(cp.isCompleted('u1'), false);
    assert.equal(cp.getCachedResult('u1'), null);
    assert.deepEqual(cp.getPending(), []);
    assert.equal(cp.getCompletedResults().length, 0);
    assert.equal(cp.getStats().total, 0);
    assert.equal(cp.getStats().enabled, false);
    // Should not throw
    cp.close();
  });
});

describe('Checkpoint — error handling', () => {
  it('throws helpful error when better-sqlite3 is missing', async () => {
    // This test only meaningful when better-sqlite3 is NOT installed
    // (otherwise we'd never hit the lazy loader's catch)
    if (betterSqliteAvailable) {
      // Skip — we can't easily simulate missing module in test
      return;
    }
    const Ckp = await loadCheckpoint();
    assert.throws(
      () => new Ckp({ dbPath: join(tmpDir, 'x.db') }),
      /better-sqlite3 is not installed/
    );
  });
});

describe('checkpointConfigFromArgs', () => {
  it('returns enabled=true by default', async () => {
    const mod = await import('./checkpoint.mjs');
    const cfg = mod.checkpointConfigFromArgs([]);
    assert.equal(cfg.enabled, true);
  });

  it('--no-checkpoint disables', async () => {
    const mod = await import('./checkpoint.mjs');
    const cfg = mod.checkpointConfigFromArgs(['--no-checkpoint']);
    assert.equal(cfg.enabled, false);
  });

  it('--checkpoint-db sets custom path', async () => {
    const mod = await import('./checkpoint.mjs');
    const cfg = mod.checkpointConfigFromArgs(['--checkpoint-db', '/tmp/custom.db']);
    assert.equal(cfg.dbPath, '/tmp/custom.db');
  });
});
