/**
 * VideoMind Configuration (Phase A Task 4)
 *
 * 用 zod 在 CLI 启动时校验配置，错误立刻崩 + 列出具体问题。
 * 优先级：CLI args > env vars > .env file > hardcoded defaults
 *
 * 三个命令的 schema：
 * - collectSchema  (collect)
 * - analyzeSchema  (analyze)
 * - syncSchema     (build / sync)
 *
 * 也提供 envOnlySchema 给纯环境变量配置（LOG_LEVEL / LOG_FILE 等，logger 用）。
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/* ============================================================
 * Enums
 * ============================================================ */

export const SUPPORTED_PLATFORMS = ['douyin', 'bilibili', 'youtube', 'xiaohongshu'];
export const SUPPORTED_ANALYZERS = ['doubao', 'kimi', 'gemini', 'claude'];
export const SUPPORTED_SINKS = ['markdown', 'lexiang', 'obsidian', 'notion'];
export const SUPPORTED_MODES = ['sequential', 'parallel'];

/* ============================================================
 * .env loader (no dotenv dep — we keep it minimal)
 * ============================================================ */

/**
 * Parse a .env file into a plain object.
 * Lines starting with # are comments; lines like `KEY=VALUE` set the value.
 * Quotes around the value are stripped; empty values are kept as ''.
 *
 * @param {string} filePath
 * @returns {Record<string, string>}
 */
export function parseDotEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const text = readFileSync(filePath, 'utf8');
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Merge multiple env sources with explicit priority.
 * Later sources override earlier ones.
 *
 * @param {Record<string,string>[]} sources - in increasing priority order
 * @returns {Record<string,string>}
 */
export function mergeEnv(...sources) {
  return Object.assign({}, ...sources);
}

/* ============================================================
 * Schemas
 * ============================================================ */

/**
 * Schema for the `collect` command.
 */
export const collectSchema = z.object({
  platform: z.enum(SUPPORTED_PLATFORMS).default('douyin'),
  collection: z.string().min(1, 'collection name cannot be empty').default('skills'),
  cdpPort: z.number().int().min(1).max(65535).default(9222),
  outputFile: z.string().min(1).default('video_list.json'),
});

/**
 * Schema for the `analyze` command.
 */
export const analyzeSchema = z.object({
  analyzer: z.enum(SUPPORTED_ANALYZERS).default('doubao'),
  mode: z.enum(SUPPORTED_MODES).default('sequential'),
  cdpPort: z.number().int().min(1).max(65535).default(9222),
  inputFile: z.string().min(1).default('video_list.json'),
  outputFile: z.string().min(1).default('video_analysis.json'),
  // Checkpoint options
  checkpointEnabled: z.boolean().default(true),
  checkpointDb: z.string().min(1).default('.videomind-checkpoint.db'),
});

/**
 * Schema for the `build` command.
 */
export const buildSchema = z.object({
  inputFile: z.string().min(1).default('video_analysis.json'),
  outputFile: z.string().min(1).default('structured_knowledge_base.json'),
});

/**
 * Schema for the `sync` command.
 */
export const syncSchema = z.object({
  sink: z.enum(SUPPORTED_SINKS).default('markdown'),
  inputFile: z.string().min(1).default('structured_knowledge_base.json'),
  outputDir: z.string().min(1).default('./output'),
});

/**
 * Schema for logger-only env config (consumed by logger.mjs).
 */
export const loggerEnvSchema = z.object({
  LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_FILE: z.string().optional(),
});

/* ============================================================
 * Error type
 * ============================================================ */

export class ConfigError extends Error {
  /**
   * @param {string} message
   * @param {Array<{path: string, message: string, code?: string}>} issues
   */
  constructor(message, issues) {
    super(message);
    this.name = 'ConfigError';
    this.issues = issues || [];
  }

  /**
   * Pretty-print the config error for human consumption.
   */
  format() {
    const lines = [`[ConfigError] ${this.message}`];
    if (this.issues.length === 0) return lines.join('\n');
    lines.push('');
    lines.push('Configuration problems:');
    for (const issue of this.issues) {
      const where = issue.path || '<root>';
      lines.push(`  - ${where}: ${issue.message}`);
    }
    lines.push('');
    lines.push('Tip: check CLI args, env vars, or .env file. Run with --help to see defaults.');
    return lines.join('\n');
  }
}

/* ============================================================
 * Helpers: parse argv into object
 * ============================================================ */

/**
 * Parse CLI args of the form `--key value` or `--flag` (boolean) into an object.
 * Numeric-looking values are coerced; explicit strings stay strings.
 *
 * @param {string[]} argv
 * @returns {Record<string, string|number|boolean>}
 */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      // boolean flag (e.g. --no-checkpoint)
      out[key] = true;
    } else {
      // value
      const v = next;
      if (/^-?\d+$/.test(v)) {
        out[key] = parseInt(v, 10);
      } else {
        out[key] = v;
      }
      i += 1;
    }
  }
  return out;
}

/**
 * Map argv keys to schema field names. Each command has its own alias map.
 */
const ARGV_ALIASES = {
  collect: {
    platform: 'platform',
    collection: 'collection',
    'cdp-port': 'cdpPort',
    'output-file': 'outputFile',
  },
  analyze: {
    analyzer: 'analyzer',
    mode: 'mode',
    'cdp-port': 'cdpPort',
    'input-file': 'inputFile',
    'output-file': 'outputFile',
    'checkpoint-db': 'checkpointDb',
    'no-checkpoint': 'checkpointEnabled',  // boolean flag, special-cased below
  },
  build: {
    'input-file': 'inputFile',
    'output-file': 'outputFile',
  },
  sync: {
    sink: 'sink',
    'input-file': 'inputFile',
    'output-dir': 'outputDir',
  },
};

/* ============================================================
 * Main: loadConfig
 * ============================================================ */

/**
 * Load and validate config for a given command.
 *
 * @param {string} command        - 'collect' | 'analyze' | 'build' | 'sync'
 * @param {object} [options]
 * @param {string[]} [options.argv]    - process.argv.slice(2) by default
 * @param {object} [options.env]       - process.env by default
 * @param {string} [options.envFile]   - path to .env (default: '.env' in cwd)
 * @returns {object} validated config
 * @throws {ConfigError} on validation failure
 */
export function loadConfig(command, options = {}) {
  const argv = options.argv !== undefined ? options.argv : process.argv.slice(2);
  const env = options.env !== undefined ? options.env : process.env;
  const envFile = options.envFile !== undefined ? options.envFile : resolve('.env');

  // 1. Build raw input from lowest to highest priority
  const dotenvVars = filterEnvVars(parseDotEnv(envFile), command);
  const envVars = filterEnvVars(env, command);
  const argvRaw = parseArgs(argv);
  const argvMapped = mapArgv(argvRaw, command);

  // 2. Merge: defaults baked into schema < dotenv < env < argv
  const merged = mergeEnv(dotenvVars, envVars, argvMapped);

  // 3. Apply schema (default values filled by zod)
  let parsed;
  try {
    parsed = applySchema(command, merged);
  } catch (e) {
    if (e instanceof z.ZodError) {
      throw new ConfigError(
        `Invalid configuration for command "${command}"`,
        e.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code }))
      );
    }
    throw e;
  }

  return parsed;
}

/* ============================================================
 * Internals
 * ============================================================ */

/**
 * Filter env vars to only those relevant for the given command.
 * Convention: env vars are uppercase, with the command name as prefix
 * (e.g. ANALYZE_MODE, COLLECT_PLATFORM). Unprefixed ones (like LOG_LEVEL)
 * are also picked up if they match a field name.
 */
function filterEnvVars(env, command) {
  const out = {};
  const prefix = command.toUpperCase() + '_';
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (key.startsWith(prefix)) {
      out[envToCamel(key.slice(prefix.length))] = value;
    }
  }
  return out;
}

function envToCamel(s) {
  return s.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function mapArgv(argv, command) {
  const aliases = ARGV_ALIASES[command] || {};
  const out = {};
  for (const [argKey, value] of Object.entries(argv)) {
    if (argKey in aliases) {
      const schemaKey = aliases[argKey];
      if (argKey === 'no-checkpoint') {
        // Inverse boolean: --no-checkpoint => checkpointEnabled = false
        out[schemaKey] = false;
      } else {
        out[schemaKey] = value;
      }
    } else {
      // pass-through unknown keys; zod will reject if not in schema
      out[envToCamel(argKey)] = value;
    }
  }
  return out;
}

function applySchema(command, input) {
  switch (command) {
    case 'collect':
      return collectSchema.parse(input);
    case 'analyze':
      return analyzeSchema.parse(input);
    case 'build':
      return buildSchema.parse(input);
    case 'sync':
      return syncSchema.parse(input);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

/* ============================================================
 * Convenience: format ConfigError for human display
 * ============================================================ */

/**
 * Print a ConfigError to stderr and exit with code 2.
 * Use this at the top of the CLI main().
 *
 * @param {Error} e
 */
export function exitOnConfigError(e) {
  if (e instanceof ConfigError) {
    process.stderr.write(e.format() + '\n');
    process.exit(2);
  }
  throw e;
}