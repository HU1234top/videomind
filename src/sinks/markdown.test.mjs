/**
 * VideoMind Unit Tests — MarkdownSink (Round 19 / L1 暴露)
 *
 * 测的是 Round 19 新加的 consensus frontmatter 暴露:
 * - v.consensus 存在 → frontmatter 加 consensus_* 字段
 * - v.consensus 不存在 → 不写 consensus_* 字段 (向后兼容)
 * - 字段值正确: mode / confidence / analyzers / failed / conflicts
 *
 * 还测基础 sink 行为 (overview / category / wikilinks) 回归.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { MarkdownSink } from './markdown.mjs';

/* ============================================================
 * Fixtures
 * ============================================================ */

function makeKb(extraVideos = []) {
  return {
    generatedAt: '2026-07-13T00:00:00Z',
    summary: { total: 2, deepAnalysis: 2, aiRelevant: 2 },
    categoryDistribution: { 'AI Agent': 2 },
    categories: {
      'AI Agent': [
        {
          url: 'https://test.com/v1',
          title: '视频A',
          author: 'Tester',
          tags: ['#AI'],
          analyzer: 'doubao',
          timestamp: '2026-07-13T01:00:00Z',
          dimensions: {
            skill_name: 'Claude 10倍速',
            skill_level: '入门',
            key_points: ['要点1'],
            auto_tags: ['#AI-Agent'],
          },
          analysis: '原文分析',
          ...extraVideos[0],
        },
      ],
    },
  };
}

function setupDir() {
  const dir = mkdtempSync(join(tmpdir(), 'videomind-md-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true }) };
}

/* ============================================================
 * Round 19: consensus frontmatter 暴露
 * ============================================================ */

describe('MarkdownSink — consensus frontmatter (Round 19)', () => {
  test('v.consensus 存在 → frontmatter 含 consensus_* 字段', async () => {
    const { dir, cleanup } = setupDir();
    try {
      const sink = new MarkdownSink({ outputDir: dir });
      const kb = makeKb([{
        consensus: {
          mode: 'multi-result',
          confidence: 0.91,
          analyzers: ['doubao', 'kimi'],
          failed: [{ analyzer: 'claude-disabled', error: 'not available' }],
          conflicts: [{ field: 'skill_name' }, { field: 'skill_level' }],
        },
      }]);
      await sink.sink(kb);
      const content = readFileSync(join(dir, 'AI Agent.md'), 'utf8');
      assert.match(content, /consensus_mode:\s*"multi-result"/);
      assert.match(content, /consensus_confidence:\s*0\.91/);
      assert.match(content, /consensus_analyzers:\s*\[.*"doubao".*,.*"kimi".*\]/);
      assert.match(content, /consensus_conflicts:\s*2/);
    } finally { cleanup(); }
  });

  test('v.consensus 缺失 → 不写 consensus_* (向后兼容)', async () => {
    const { dir, cleanup } = setupDir();
    try {
      const sink = new MarkdownSink({ outputDir: dir });
      const kb = makeKb();
      await sink.sink(kb);
      const content = readFileSync(join(dir, 'AI Agent.md'), 'utf8');
      assert.doesNotMatch(content, /consensus_mode/);
      assert.doesNotMatch(content, /consensus_confidence/);
    } finally { cleanup(); }
  });

  test('confidence 小数保留 2 位', async () => {
    const { dir, cleanup } = setupDir();
    try {
      const sink = new MarkdownSink({ outputDir: dir });
      const kb = makeKb([{
        consensus: { mode: 'multi-result', confidence: 0.81818181, analyzers: ['a', 'b'] },
      }]);
      await sink.sink(kb);
      const content = readFileSync(join(dir, 'AI Agent.md'), 'utf8');
      assert.match(content, /consensus_confidence:\s*0\.82/);
    } finally { cleanup(); }
  });

  test('failed 列表空字符串安全', async () => {
    const { dir, cleanup } = setupDir();
    try {
      const sink = new MarkdownSink({ outputDir: dir });
      const kb = makeKb([{
        consensus: {
          mode: 'multi-result',
          confidence: 1.0,
          analyzers: ['doubao'],
          failed: [],
          conflicts: [],
        },
      }]);
      await sink.sink(kb);
      const content = readFileSync(join(dir, 'AI Agent.md'), 'utf8');
      // 空数组 [] 是 OK
      assert.match(content, /consensus_failed:\s*\[\]/);
    } finally { cleanup(); }
  });
});

/* ============================================================
 * 基础 sink 行为 (回归)
 * ============================================================ */

describe('MarkdownSink — basic functionality (regression)', () => {
  test('writeOverview 写总览文件', async () => {
    const { dir, cleanup } = setupDir();
    try {
      const sink = new MarkdownSink({ outputDir: dir });
      const kb = makeKb();
      await sink.sink(kb);
      assert.ok(existsSync(join(dir, '总览与统计.md')));
      const content = readFileSync(join(dir, '总览与统计.md'), 'utf8');
      assert.match(content, /总视频数:\s*2/);
      assert.match(content, /深度分析:\s*2/);
    } finally { cleanup(); }
  });

  test('writeCategory 写分类文件', async () => {
    const { dir, cleanup } = setupDir();
    try {
      const sink = new MarkdownSink({ outputDir: dir });
      const kb = makeKb();
      await sink.sink(kb);
      assert.ok(existsSync(join(dir, 'AI Agent.md')));
      const content = readFileSync(join(dir, 'AI Agent.md'), 'utf8');
      assert.match(content, /category:\s*"AI Agent"/);
      assert.match(content, /skill_name:\s*"Claude 10倍速"/);
    } finally { cleanup(); }
  });
});
