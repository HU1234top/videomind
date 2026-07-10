/**
 * VideoMind Structured Logger (Phase A Task 3)
 *
 * 替代散落的 console.log，提供：
 * - 字段化日志（requestId / platform / stage）便于 grep / 关联
 * - 等级控制（LOG_LEVEL=info|debug|warn|error|silent）
 * - 子 logger（每个 collector / analyzer / 阶段一个 child，自动带父字段）
 * - 可选文件输出（LOG_FILE=/path/to/log.json）
 * - 失败容错（pino 加载失败时降级到 console）
 *
 * 依赖：pino（运行时，如果缺失则降级到 console-backed JSON logger）。
 */

import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/* ============================================================
 * Configuration
 * ============================================================ */

/**
 * Resolve log config from env (with safe defaults).
 * @returns {{ level: string, file: string|null }}
 */
export function loggerConfigFromEnv(env = process.env) {
  const level = (env.LOG_LEVEL || 'info').toLowerCase();
  const file = env.LOG_FILE || null;
  return { level, file };
}

/* ============================================================
 * Sink streams
 * ============================================================ */

function buildDestinations(file) {
  const streams = [{ stream: process.stdout }];

  if (file) {
    try {
      const dir = dirname(file);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      streams.push({ stream: createWriteStream(file, { flags: 'a' }) });
    } catch (e) {
      // Don't crash the app if we can't open the log file
      process.stderr.write(`[logger] failed to open LOG_FILE=${file}: ${e.message}\n`);
    }
  }

  return streams;
}

/* ============================================================
 * Logger factory
 * ============================================================ */

/**
 * Try loading pino synchronously via createRequire. Returns null if not installed.
 */
function tryLoadPino() {
  try {
    return require('pino');
  } catch (_) {
    return null;
  }
}

/**
 * Build a pino-backed logger (sync). Returns null if pino unavailable.
 */
function buildPinoLogger(baseFields, level, file) {
  const pino = tryLoadPino();
  if (!pino) return null;

  const destinations = buildDestinations(file);
  try {
    const logger = pino(
      {
        level,
        base: baseFields,
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
          level: (label) => ({ level: label }),
        },
      },
      pino.multistream(destinations)
    );
    return logger;
  } catch (_) {
    return null;
  }
}

/**
 * Build a logger instance.
 *
 * @param {object} [opts]
 * @param {string} [opts.name='videomind']     - top-level component name
 * @param {string} [opts.level]                - overrides LOG_LEVEL
 * @param {string} [opts.requestId]            - batch/session correlation id
 * @param {object} [opts.base]                 - extra fields attached to every log line
 * @param {string} [opts.file]                 - overrides LOG_FILE
 * @returns {object} logger
 */
export function createLogger(opts = {}) {
  const cfg = loggerConfigFromEnv();
  const level = (opts.level || cfg.level || 'info').toLowerCase();
  const requestId = opts.requestId || randomUUID();
  const base = opts.base || {};
  const name = opts.name || 'videomind';
  const file = opts.file !== undefined ? opts.file : cfg.file;

  const baseFields = { name, requestId, pid: process.pid, ...base };

  const pinoLogger = buildPinoLogger(baseFields, level, file);
  if (pinoLogger) {
    return wrapPino(pinoLogger, baseFields);
  }
  return makeFallbackLogger(baseFields, level);
}

/**
 * Convenience: create a child logger tagged with stage + component.
 *
 * @param {string} stage         - 'collect' | 'analyze' | 'build' | 'sync'
 * @param {string} [component]   - sub-component (e.g. 'doubao', 'douyin')
 * @param {string} [requestId]   - inherit parent's requestId if omitted
 * @param {object} [opts]        - extra fields / overrides
 */
export function stageLogger(stage, component = null, requestId = null, opts = {}) {
  const base = { stage, ...(component ? { component } : {}), ...(opts.base || {}) };
  return createLogger({
    ...opts,
    base,
    requestId: requestId || opts.requestId,
    name: opts.name || 'videomind',
  });
}

/* ============================================================
 * Logger wrapping (uniform API regardless of backend)
 * ============================================================ */

function wrapPino(logger, baseFields) {
  const child = (extra = {}) => {
    const fields = { ...baseFields, ...extra };
    return wrapPino(logger.child(extra), fields);
  };
  return {
    child,
    info: (obj, msg) => logger.info(obj, msg),
    debug: (obj, msg) => logger.debug(obj, msg),
    warn: (obj, msg) => logger.warn(obj, msg),
    error: (obj, msg) => logger.error(obj, msg),
    fatal: (obj, msg) => logger.fatal(obj, msg),
    raw: logger,
  };
}

function makeFallbackLogger(baseFields, level) {
  const order = { silent: -1, error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
  const threshold = order[level] ?? 2;

  const emit = (lvl, obj, msg) => {
    if (order[lvl] === undefined || order[lvl] > threshold) return;
    const fields = typeof obj === 'object' && obj !== null && !Array.isArray(obj) ? obj : { value: obj };
    const line = {
      ts: new Date().toISOString(),
      level: lvl,
      ...baseFields,
      ...fields,
      ...(msg ? { msg } : {}),
    };
    process.stdout.write(JSON.stringify(line) + '\n');
  };

  const child = (extra = {}) => {
    const fields = { ...baseFields, ...extra };
    return makeFallbackLogger(fields, level);
  };

  return {
    child,
    info: (obj, msg) => emit('info', obj, msg),
    debug: (obj, msg) => emit('debug', obj, msg),
    warn: (obj, msg) => emit('warn', obj, msg),
    error: (obj, msg) => emit('error', obj, msg),
    fatal: (obj, msg) => emit('fatal', obj, msg),
    raw: null,
  };
}

/* ============================================================
 * Default singleton
 * ============================================================ */

let _default = null;

/**
 * Get the shared default logger (lazily initialized).
 */
export function getLogger() {
  if (!_default) _default = createLogger({ name: 'videomind' });
  return _default;
}

/**
 * Reset the shared default logger (for tests).
 */
export function _resetDefaultLogger() {
  _default = null;
}