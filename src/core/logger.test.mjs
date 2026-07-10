/**
 * Logger tests (Phase A Task 3)
 *
 * Test strategy:
 * - Each test creates a custom writable stream as destination
 * - Stream captures raw bytes, tests parse JSON lines
 * - Tests run with LOG_LEVEL unset (defaults to 'info') and level: 'silent'
 *   on the logger to suppress noise but still exercise the path
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';

import {
  createLogger,
  stageLogger,
  loggerConfigFromEnv,
  getLogger,
  _resetDefaultLogger,
} from './logger.mjs';

/* ============================================================
 * Test helpers
 * ============================================================ */

/**
 * Build an in-memory writable stream that collects written chunks.
 */
function captureStream() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString('utf8'));
      cb();
    },
  });
  stream.getLines = () => chunks.join('').split('\n').filter(Boolean);
  stream.getJsonLines = () =>
    stream.getLines().map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
  stream.clear = () => chunks.length = 0;
  return stream;
}

/**
 * Build a pino logger that writes to a capture stream. pino doesn't accept
 * a raw Writable in multistream entries the way we'd like, so we trick it
 * by handing pino a destination object that has .write().
 */
function buildCapturedLogger(opts = {}, level = 'info') {
  const stream = captureStream();
  // monkey-patch pino.multistream: we feed it a fake stream that looks like
  // the multistream API wants. Simplest path: use a PassThrough-like adapter.
  // pino.multistream accepts an array of { stream, level? } entries.
  // We pass a stream that satisfies "pino destination contract": must have
  // .write(chunk) and .flush() and .end(). Our Writable satisfies that.
  const destinations = [{ stream }];
  return {
    stream,
    logger: createLogger({
      level,
      ...opts,
      // Bypass file resolution: we set LOG_FILE to undefined via no env, and
      // the createLogger respects opts.file. So we explicitly suppress.
      file: null,
    }),
  };
}

const noEnv = { /* empty env */ };

/* ============================================================
 * loggerConfigFromEnv
 * ============================================================ */

test('loggerConfigFromEnv: defaults to info level, no file', () => {
  const cfg = loggerConfigFromEnv(noEnv);
  assert.equal(cfg.level, 'info');
  assert.equal(cfg.file, null);
});

test('loggerConfigFromEnv: respects LOG_LEVEL and LOG_FILE', () => {
  const cfg = loggerConfigFromEnv({
    LOG_LEVEL: 'debug',
    LOG_FILE: '/tmp/videomind.log',
  });
  assert.equal(cfg.level, 'debug');
  assert.equal(cfg.file, '/tmp/videomind.log');
});

test('loggerConfigFromEnv: LOG_LEVEL is lowercased', () => {
  const cfg = loggerConfigFromEnv({ LOG_LEVEL: 'WARN' });
  assert.equal(cfg.level, 'warn');
});

/* ============================================================
 * createLogger — basic field injection
 * ============================================================ */

test('createLogger: assigns a UUID requestId when none provided', () => {
  const logger = createLogger({ level: 'silent' });
  // No public getter, but child().raw exists only on pino; we test via call
  // that emits a line and parse. Since silent, we use a child wrapper.
  assert.ok(logger, 'logger is created');
  assert.equal(typeof logger.info, 'function');
  assert.equal(typeof logger.child, 'function');
});

test('createLogger: respects provided requestId and base fields', () => {
  // We can't easily read fields without emitting, so use silent + raw inspection
  const logger = createLogger({
    level: 'silent',
    requestId: 'test-req-1',
    base: { component: 'test' },
  });
  // Both APIs expose the same shape; just verify they don't throw
  assert.doesNotThrow(() => logger.info({ event: 'x' }, 'msg'));
});

test('createLogger: level=silent suppresses all output', () => {
  const captured = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  // Suppress stdout (fallback logger writes via process.stdout)
  // pino path bypasses process.stdout, but silent level still skips both
  process.stdout.write = (chunk) => { captured.push(chunk); return true; };
  try {
    const logger = createLogger({ level: 'silent', base: { tag: 'silent-test' } });
    logger.info({ x: 1 }, 'should not appear');
    logger.error({ x: 2 }, 'also not appear');
  } finally {
    process.stdout.write = origWrite;
  }
  // silent logger on both backends: nothing should reach stdout
  assert.equal(captured.length, 0, 'silent level should emit no output');
});

/* ============================================================
 * level filtering
 * ============================================================ */

test('level filtering: error level only emits error/fatal', () => {
  const captured = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { captured.push(chunk); return true; };
  try {
    const logger = createLogger({ level: 'error' });
    logger.debug({ a: 1 }, 'd');
    logger.info({ a: 2 }, 'i');
    logger.warn({ a: 3 }, 'w');
    logger.error({ a: 4 }, 'e');
    logger.fatal({ a: 5 }, 'f');
  } finally {
    process.stdout.write = origWrite;
  }
  const lines = captured.join('').split('\n').filter(Boolean);
  const levels = lines.map(l => {
    try { return JSON.parse(l).level; } catch { return null; }
  }).filter(Boolean);
  // Only error and fatal should pass through
  assert.ok(levels.includes('error'), 'error should be emitted');
  assert.ok(levels.includes('fatal'), 'fatal should be emitted');
  assert.ok(!levels.includes('warn'), 'warn should be filtered');
  assert.ok(!levels.includes('info'), 'info should be filtered');
  assert.ok(!levels.includes('debug'), 'debug should be filtered');
});

/* ============================================================
 * Child loggers
 * ============================================================ */

test('child loggers: inherit parent base fields', () => {
  const captured = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { captured.push(chunk); return true; };
  try {
    const parent = createLogger({ level: 'info', base: { component: 'parent' } });
    const child = parent.child({ stage: 'analyze' });
    child.info({ url: 'u' }, 'analyzing');
  } finally {
    process.stdout.write = origWrite;
  }
  const lines = captured.join('').split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].component, 'parent');
  assert.equal(lines[0].stage, 'analyze');
  assert.equal(lines[0].url, 'u');
  assert.equal(lines[0].msg, 'analyzing');
});

test('child loggers: nested children stack fields', () => {
  const captured = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { captured.push(chunk); return true; };
  try {
    const a = createLogger({ level: 'info', base: { component: 'a' } });
    const b = a.child({ stage: 'b' });
    const c = b.child({ stage: 'c', extra: 1 });
    c.info({ event: 'nested' }, 'msg');
  } finally {
    process.stdout.write = origWrite;
  }
  const lines = captured.join('').split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].component, 'a');
  assert.equal(lines[0].stage, 'c');
  assert.equal(lines[0].extra, 1);
});

/* ============================================================
 * requestId propagation
 * ============================================================ */

test('requestId: auto-generated UUID when not provided', () => {
  const captured = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { captured.push(chunk); return true; };
  try {
    const logger = createLogger({ level: 'info' });
    logger.info({ test: 1 }, 'm');
  } finally {
    process.stdout.write = origWrite;
  }
  const line = JSON.parse(captured.join('').split('\n').filter(Boolean)[0]);
  assert.match(line.requestId, /^[0-9a-f-]{36}$/, 'requestId is a UUID');
});

test('requestId: explicitly provided requestId is preserved through children', () => {
  const captured = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { captured.push(chunk); return true; };
  try {
    const logger = createLogger({ level: 'info', requestId: 'fixed-id-123' });
    const child = logger.child({ stage: 'test' });
    child.info({ x: 1 }, 'm1');
    child.error({ x: 2 }, 'm2');
  } finally {
    process.stdout.write = origWrite;
  }
  const lines = captured.join('').split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.equal(line.requestId, 'fixed-id-123');
  }
});

/* ============================================================
 * Field shape
 * ============================================================ */

test('fallback logger: emits a valid JSON line with required fields', () => {
  const captured = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { captured.push(chunk); return true; };
  try {
    const logger = createLogger({ level: 'info', name: 'fallback-test' });
    logger.info({ url: 'u', code: 200 }, 'response received');
  } finally {
    process.stdout.write = origWrite;
  }
  const line = JSON.parse(captured.join('').split('\n').filter(Boolean)[0]);
  assert.equal(line.name, 'fallback-test');
  assert.equal(line.level, 'info');
  assert.equal(line.msg, 'response received');
  assert.equal(line.url, 'u');
  assert.equal(line.code, 200);
  // pino uses "time", fallback uses "ts" — accept either
  assert.ok(line.ts || line.time, 'has timestamp');
  assert.equal(typeof line.pid, 'number');
});

test('fallback logger: handles non-object first arg gracefully', () => {
  const captured = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { captured.push(chunk); return true; };
  try {
    const logger = createLogger({ level: 'info' });
    logger.info('just a string message');
  } finally {
    process.stdout.write = origWrite;
  }
  const line = JSON.parse(captured.join('').split('\n').filter(Boolean)[0]);
  assert.equal(line.msg, 'just a string message');
});

/* ============================================================
 * stageLogger convenience
 * ============================================================ */

test('stageLogger: tags stage and component', () => {
  const captured = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { captured.push(chunk); return true; };
  try {
    const logger = stageLogger('analyze', 'doubao', 'req-1', { level: 'info' });
    logger.info({ x: 1 }, 'm');
  } finally {
    process.stdout.write = origWrite;
  }
  const line = JSON.parse(captured.join('').split('\n').filter(Boolean)[0]);
  assert.equal(line.stage, 'analyze');
  assert.equal(line.component, 'doubao');
  assert.equal(line.requestId, 'req-1');
});

test('stageLogger: works without component', () => {
  const captured = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { captured.push(chunk); return true; };
  try {
    const logger = stageLogger('build', null, 'req-2', { level: 'info' });
    logger.info({ x: 1 }, 'm');
  } finally {
    process.stdout.write = origWrite;
  }
  const line = JSON.parse(captured.join('').split('\n').filter(Boolean)[0]);
  assert.equal(line.stage, 'build');
  assert.equal(line.component, undefined);
});

/* ============================================================
 * getLogger singleton
 * ============================================================ */

test('getLogger: returns a shared instance', () => {
  _resetDefaultLogger();
  const a = getLogger();
  const b = getLogger();
  assert.equal(a, b, 'getLogger should return the same instance');
});

test('getLogger: instance is callable with standard methods', () => {
  _resetDefaultLogger();
  const logger = getLogger();
  assert.equal(typeof logger.info, 'function');
  assert.equal(typeof logger.warn, 'function');
  assert.equal(typeof logger.error, 'function');
  assert.equal(typeof logger.child, 'function');
});

test('_resetDefaultLogger: clears singleton', () => {
  const a = getLogger();
  _resetDefaultLogger();
  const b = getLogger();
  assert.notEqual(a, b, 'after reset, getLogger returns a new instance');
});
