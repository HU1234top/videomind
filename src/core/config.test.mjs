/**
 * Config tests (Phase A Task 4)
 *
 * Coverage:
 * - parseArgs: --key value, --key (boolean), numeric coercion
 * - parseDotEnv: comments, blank lines, quoted values, missing file
 * - loadConfig: defaults, env override, argv override, validation errors
 * - ConfigError: format() output structure
 * - All four commands (collect / analyze / build / sync)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseArgs,
  parseDotEnv,
  loadConfig,
  ConfigError,
  collectSchema,
  analyzeSchema,
  buildSchema,
  syncSchema,
  SUPPORTED_PLATFORMS,
  SUPPORTED_ANALYZERS,
  SUPPORTED_SINKS,
  SUPPORTED_MODES,
} from './config.mjs';

/* ============================================================
 * parseArgs
 * ============================================================ */

test('parseArgs: parses --key value pairs', () => {
  const result = parseArgs(['--platform', 'douyin', '--collection', 'skills']);
  assert.equal(result.platform, 'douyin');
  assert.equal(result.collection, 'skills');
});

test('parseArgs: parses boolean flags (no value follows)', () => {
  const result = parseArgs(['--no-checkpoint']);
  assert.equal(result['no-checkpoint'], true);
});

test('parseArgs: coerces integer-looking values to numbers', () => {
  const result = parseArgs(['--cdp-port', '9222']);
  assert.equal(result['cdp-port'], 9222);
  assert.equal(typeof result['cdp-port'], 'number');
});

test('parseArgs: negative integers are coerced', () => {
  const result = parseArgs(['--offset', '-5']);
  assert.equal(result.offset, -5);
});

test('parseArgs: leaves non-numeric strings as strings', () => {
  const result = parseArgs(['--name', 'my-thing']);
  assert.equal(typeof result.name, 'string');
  assert.equal(result.name, 'my-thing');
});

test('parseArgs: ignores positional (non --) args', () => {
  const result = parseArgs(['analyze', '--platform', 'douyin']);
  assert.equal(result.platform, 'douyin');
  assert.equal(result.analyze, undefined);
});

/* ============================================================
 * parseDotEnv
 * ============================================================ */

test('parseDotEnv: returns empty object for missing file', () => {
  const result = parseDotEnv('/nonexistent/.env');
  assert.deepEqual(result, {});
});

test('parseDotEnv: parses basic key=value pairs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'videomind-dotenv-'));
  const path = join(dir, '.env');
  writeFileSync(path, 'KEY1=value1\nKEY2=value2\n');
  try {
    const result = parseDotEnv(path);
    assert.equal(result.KEY1, 'value1');
    assert.equal(result.KEY2, 'value2');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('parseDotEnv: strips # comments and blank lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'videomind-dotenv-'));
  const path = join(dir, '.env');
  writeFileSync(path, '# this is a comment\n\nKEY=value\n  # another comment\n');
  try {
    const result = parseDotEnv(path);
    assert.deepEqual(result, { KEY: 'value' });
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('parseDotEnv: strips surrounding single or double quotes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'videomind-dotenv-'));
  const path = join(dir, '.env');
  writeFileSync(path, 'A="quoted"\nB=\'single\'\nC=unquoted\n');
  try {
    const result = parseDotEnv(path);
    assert.equal(result.A, 'quoted');
    assert.equal(result.B, 'single');
    assert.equal(result.C, 'unquoted');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('parseDotEnv: handles CR/LF line endings (Windows)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'videomind-dotenv-'));
  const path = join(dir, '.env');
  writeFileSync(path, 'A=1\r\nB=2\r\n');
  try {
    const result = parseDotEnv(path);
    assert.equal(result.A, '1');
    assert.equal(result.B, '2');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

/* ============================================================
 * loadConfig — collect
 * ============================================================ */

test('loadConfig(collect): all defaults when nothing provided', () => {
  const cfg = loadConfig('collect', { argv: [], env: {} });
  assert.equal(cfg.platform, 'douyin');
  assert.equal(cfg.collection, 'skills');
  assert.equal(cfg.cdpPort, 9222);
  assert.equal(cfg.outputFile, 'video_list.json');
});

test('loadConfig(collect): CLI args override defaults', () => {
  const cfg = loadConfig('collect', { argv: ['--platform', 'bilibili', '--cdp-port', '9333'], env: {} });
  assert.equal(cfg.platform, 'bilibili');
  assert.equal(cfg.cdpPort, 9333);
});

test('loadConfig(collect): env vars override defaults (but CLI wins)', () => {
  const cfg = loadConfig('collect', { argv: [], env: { COLLECT_PLATFORM: 'youtube' } });
  assert.equal(cfg.platform, 'youtube');
});

test('loadConfig(collect): CLI beats env', () => {
  const cfg = loadConfig('collect', {
    argv: ['--platform', 'douyin'],
    env: { COLLECT_PLATFORM: 'youtube' },
  });
  assert.equal(cfg.platform, 'douyin');
});

test('loadConfig(collect): rejects invalid platform with field path', () => {
  try {
    loadConfig('collect', { argv: ['--platform', 'tiktok'], env: {} });
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof ConfigError);
    assert.ok(e.issues.length >= 1);
    assert.equal(e.issues[0].path, 'platform');
  }
});

test('loadConfig(collect): rejects out-of-range cdpPort', () => {
  try {
    loadConfig('collect', { argv: ['--cdp-port', '99999'], env: {} });
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof ConfigError);
    assert.equal(e.issues[0].path, 'cdpPort');
  }
});

/* ============================================================
 * loadConfig — analyze
 * ============================================================ */

test('loadConfig(analyze): all defaults', () => {
  const cfg = loadConfig('analyze', { argv: [], env: {} });
  assert.equal(cfg.analyzer, 'doubao');
  assert.equal(cfg.mode, 'sequential');
  assert.equal(cfg.checkpointEnabled, true);
  assert.equal(cfg.checkpointDb, '.videomind-checkpoint.db');
});

test('loadConfig(analyze): --no-checkpoint sets checkpointEnabled=false', () => {
  const cfg = loadConfig('analyze', { argv: ['--no-checkpoint'], env: {} });
  assert.equal(cfg.checkpointEnabled, false);
});

test('loadConfig(analyze): rejects invalid analyzer', () => {
  try {
    loadConfig('analyze', { argv: ['--analyzer', 'gpt4'], env: {} });
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof ConfigError);
    assert.equal(e.issues[0].path, 'analyzer');
  }
});

test('loadConfig(analyze): rejects invalid mode', () => {
  try {
    loadConfig('analyze', { argv: ['--mode', 'parallel-async'], env: {} });
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof ConfigError);
    assert.equal(e.issues[0].path, 'mode');
  }
});

test('loadConfig(analyze): reports multiple errors at once', () => {
  try {
    loadConfig('analyze', { argv: ['--analyzer', 'gpt4', '--mode', 'banana'], env: {} });
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof ConfigError);
    assert.ok(e.issues.length >= 2);
    const paths = e.issues.map((i) => i.path);
    assert.ok(paths.includes('analyzer'));
    assert.ok(paths.includes('mode'));
  }
});

/* ============================================================
 * loadConfig — build / sync
 * ============================================================ */

test('loadConfig(build): defaults', () => {
  const cfg = loadConfig('build', { argv: [], env: {} });
  assert.equal(cfg.inputFile, 'video_analysis.json');
  assert.equal(cfg.outputFile, 'structured_knowledge_base.json');
});

test('loadConfig(build): custom input/output via CLI', () => {
  const cfg = loadConfig('build', {
    argv: ['--input-file', 'in.json', '--output-file', 'out.json'],
    env: {},
  });
  assert.equal(cfg.inputFile, 'in.json');
  assert.equal(cfg.outputFile, 'out.json');
});

test('loadConfig(sync): defaults', () => {
  const cfg = loadConfig('sync', { argv: [], env: {} });
  assert.equal(cfg.sink, 'markdown');
  assert.equal(cfg.inputFile, 'structured_knowledge_base.json');
});

test('loadConfig(sync): --sink obsidian', () => {
  const cfg = loadConfig('sync', { argv: ['--sink', 'obsidian'], env: {} });
  assert.equal(cfg.sink, 'obsidian');
});

test('loadConfig(sync): rejects unknown sink', () => {
  try {
    loadConfig('sync', { argv: ['--sink', 'wordpress'], env: {} });
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof ConfigError);
    assert.equal(e.issues[0].path, 'sink');
  }
});

/* ============================================================
 * ConfigError
 * ============================================================ */

test('ConfigError.format: includes header, issues, and tip', () => {
  const e = new ConfigError('test', [
    { path: 'foo', message: 'is required' },
    { path: 'bar.baz', message: 'must be a number' },
  ]);
  const out = e.format();
  assert.ok(out.includes('ConfigError'));
  assert.ok(out.includes('foo: is required'));
  assert.ok(out.includes('bar.baz: must be a number'));
  assert.ok(out.includes('Tip:'));
});

test('ConfigError: is instanceof Error', () => {
  const e = new ConfigError('test', []);
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'ConfigError');
});

/* ============================================================
 * Schema enums match published values
 * ============================================================ */

test('SUPPORTED_PLATFORMS includes douyin/bilibili/youtube/xiaohongshu', () => {
  assert.deepEqual(SUPPORTED_PLATFORMS, ['douyin', 'bilibili', 'youtube', 'xiaohongshu']);
});

test('SUPPORTED_ANALYZERS includes doubao/kimi', () => {
  assert.deepEqual(SUPPORTED_ANALYZERS, ['doubao', 'kimi']);
});

test('SUPPORTED_SINKS includes markdown/lexiang/obsidian/notion', () => {
  assert.deepEqual(SUPPORTED_SINKS, ['markdown', 'lexiang', 'obsidian', 'notion']);
});

test('SUPPORTED_MODES includes sequential/parallel', () => {
  assert.deepEqual(SUPPORTED_MODES, ['sequential', 'parallel']);
});

/* ============================================================
 * Schemas are direct zod objects
 * ============================================================ */

test('all schemas are exported zod objects with .parse', () => {
  assert.equal(typeof collectSchema.parse, 'function');
  assert.equal(typeof analyzeSchema.parse, 'function');
  assert.equal(typeof buildSchema.parse, 'function');
  assert.equal(typeof syncSchema.parse, 'function');
});

/* ============================================================
 * .env file integration
 * ============================================================ */

test('loadConfig(collect): loads from .env file when present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'videomind-cfg-'));
  const envPath = join(dir, '.env');
  writeFileSync(envPath, 'COLLECT_PLATFORM=youtube\nCOLLECT_COLLECTION=my-favs\n');
  try {
    const cfg = loadConfig('collect', { argv: [], env: {}, envFile: envPath });
    assert.equal(cfg.platform, 'youtube');
    assert.equal(cfg.collection, 'my-favs');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('loadConfig(collect): .env < env var in priority', () => {
  const dir = mkdtempSync(join(tmpdir(), 'videomind-cfg-'));
  const envPath = join(dir, '.env');
  writeFileSync(envPath, 'COLLECT_PLATFORM=youtube\n');
  try {
    const cfg = loadConfig('collect', {
      argv: [],
      env: { COLLECT_PLATFORM: 'bilibili' },
      envFile: envPath,
    });
    // .env was loaded with 'youtube', then env var overrode to 'bilibili'
    assert.equal(cfg.platform, 'bilibili');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('loadConfig(collect): missing .env file is silently ignored', () => {
  // Should not throw
  const cfg = loadConfig('collect', {
    argv: [],
    env: {},
    envFile: '/nonexistent/.env',
  });
  assert.equal(cfg.platform, 'douyin');
});