/**
 * VideoMind Unit Tests — Consensus Arbiter (Round 18 / L1)
 *
 * Tests cover:
 * - 全部失败 → throw
 * - 单结果 → confidence = 1, mode = single-result
 * - 多结果完全一致 → confidence = 1, conflicts = []
 * - 多结果部分冲突 → 用 primary 值, conflict 列表完整
 * - Array 字段 (key_points) 顺序无关比较
 * - String 字段 (skill_name) 大小写无关
 * - failed analyzers 进入 consensus.failed
 * - 排序: primary 排第一
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arbitrate } from './consensus.mjs';

const FOO_DIM = {
  skill_name: 'Claude 10倍速学习法',
  skill_level: '入门',
  key_points: ['要点1', '要点2'],
  action_steps: ['步骤1', '步骤2'],
  tools_resources: ['Claude.ai'],
  pitfalls: ['陷阱1'],
  use_cases: 'AI 工程师',
  prerequisites: '基础编程',
  learning_path: '跟视频一起学',
  transcript: '这是逐字记录',
  auto_tags: ['#AI', '#学习'],
};

describe('Consensus.arbitrate — error / edge cases', () => {
  test('all analyzers failed → throw', () => {
    assert.throws(() => arbitrate([
      { analyzer: 'doubao', result: null, error: new Error('x') },
      { analyzer: 'kimi', result: null, error: new Error('y') },
    ]), /all analyzers failed/);
  });

  test('all results null → throw', () => {
    assert.throws(() => arbitrate([
      { analyzer: 'doubao', result: null },
      { analyzer: 'kimi', result: null },
    ]), /all analyzers failed/);
  });

  test('single result ok → confidence 1.0, mode single-result', () => {
    const { result, consensus } = arbitrate([
      { analyzer: 'doubao', result: { url: 'u', dimensions: FOO_DIM } },
    ]);
    assert.equal(consensus.confidence, 1.0);
    assert.equal(consensus.mode, 'single-result');
    assert.equal(consensus.analyzers.length, 1);
    assert.equal(result.dimensions.skill_name, FOO_DIM.skill_name);
  });
});

describe('Consensus.arbitrate — full agreement', () => {
  test('two results identical → confidence 1.0, no conflicts', () => {
    const { result, consensus } = arbitrate([
      { analyzer: 'doubao', result: { url: 'u', dimensions: { ...FOO_DIM } } },
      { analyzer: 'kimi',   result: { url: 'u', dimensions: { ...FOO_DIM } } },
    ]);
    assert.equal(consensus.confidence, 1.0);
    assert.equal(consensus.conflicts.length, 0);
    assert.equal(consensus.mode, 'multi-result');
    assert.equal(result.dimensions.skill_name, FOO_DIM.skill_name);
  });

  test('array fields in different order still agree', () => {
    const { consensus } = arbitrate([
      { analyzer: 'doubao', result: { url: 'u', dimensions: { ...FOO_DIM, key_points: ['a', 'b', 'c'] } } },
      { analyzer: 'kimi',   result: { url: 'u', dimensions: { ...FOO_DIM, key_points: ['c', 'a', 'b'] } } },
    ]);
    assert.equal(consensus.confidence, 1.0);
    assert.equal(consensus.conflicts.length, 0);
  });

  test('string fields trim/lowercase ok (空格无影响)', () => {
    const { consensus } = arbitrate([
      { analyzer: 'doubao', result: { url: 'u', dimensions: { ...FOO_DIM, skill_name: 'claude 10倍速' } } },
      { analyzer: 'kimi',   result: { url: 'u', dimensions: { ...FOO_DIM, skill_name: '  Claude 10倍速  ' } } },
    ]);
    assert.equal(consensus.confidence, 1.0);
    assert.equal(consensus.conflicts.length, 0);
  });
});

describe('Consensus.arbitrate — partial conflict', () => {
  test('one field differs → conflict listed, primary wins', () => {
    const dimA = { ...FOO_DIM, skill_name: 'Claude 10倍速' };
    const dimB = { ...FOO_DIM, skill_name: 'Kimi 提速法' };
    const { result, consensus } = arbitrate([
      { analyzer: 'doubao', result: { url: 'u', dimensions: dimA } },
      { analyzer: 'kimi',   result: { url: 'u', dimensions: dimB } },
    ], { primary: 'doubao' });
    assert.equal(consensus.conflicts.length, 1);
    assert.equal(consensus.conflicts[0].field, 'skill_name');
    assert.equal(consensus.conflicts[0].winner, 'doubao');
    assert.equal(result.dimensions.skill_name, 'Claude 10倍速');
    // 1 个字段冲突 (10/11 一致)
    assert.equal(consensus.confidence, 10 / 11);
  });

  test('2 fields differ → confidence = 9/11, 2 个 conflict', () => {
    const dimA = { ...FOO_DIM, skill_name: 'A', skill_level: '入门' };
    const dimB = { ...FOO_DIM, skill_name: 'B', skill_level: '高级' };
    const { consensus } = arbitrate([
      { analyzer: 'doubao', result: { url: 'u', dimensions: dimA } },
      { analyzer: 'kimi',   result: { url: 'u', dimensions: dimB } },
    ]);
    assert.equal(consensus.conflicts.length, 2);
    assert.equal(consensus.confidence, 9 / 11);
  });

  test('failed analyzers 进入 consensus.failed', () => {
    const { consensus } = arbitrate([
      { analyzer: 'doubao', result: { url: 'u', dimensions: { ...FOO_DIM } } },
      { analyzer: 'kimi',   result: null, error: new Error('NotLoggedIn') },
    ]);
    assert.equal(consensus.analyzers.length, 1);
    assert.equal(consensus.failed.length, 1);
    assert.equal(consensus.failed[0].analyzer, 'kimi');
  });
});

describe('Consensus.arbitrate — primary 重排', () => {
  test('primary 在 responses[1] 时排第一, 用 primary 的值胜冲突', () => {
    const dimA = { ...FOO_DIM, skill_name: 'A loses (kimi value)' };
    const dimB = { ...FOO_DIM, skill_name: 'B wins (doubao value)' };
    const { result, consensus } = arbitrate([
      { analyzer: 'kimi',   result: { url: 'u', dimensions: dimA } },
      { analyzer: 'doubao', result: { url: 'u', dimensions: dimB } },
    ], { primary: 'doubao' });
    assert.equal(consensus.analyzers[0], 'doubao');  // primary 排第一
    assert.equal(result.dimensions.skill_name, 'B wins (doubao value)');  // 用 primary 值
    assert.equal(consensus.conflicts[0].winner, 'doubao');
  });

  test('primary 不存在时 fallback 到 responses[0]', () => {
    const dimA = { ...FOO_DIM, skill_name: 'A' };
    const dimB = { ...FOO_DIM, skill_name: 'B' };
    const { result } = arbitrate([
      { analyzer: 'kimi',   result: { url: 'u', dimensions: dimA } },
      { analyzer: 'doubao', result: { url: 'u', dimensions: dimB } },
    ], { primary: 'not-exists' });
    // primary 不存在 → 用 responses[0] (kimi) 的值
    assert.equal(result.dimensions.skill_name, 'A');
  });
});

describe('Consensus.arbitrate — 内部 helper (DIMENSION_KEYS / ARRAY_KEYS)', () => {
  test('transcript 字段一字不差才算一致', () => {
    const dimA = { ...FOO_DIM, transcript: '第一段...' };
    const dimB = { ...FOO_DIM, transcript: '第二段...' };
    const { consensus } = arbitrate([
      { analyzer: 'doubao', result: { url: 'u', dimensions: dimA } },
      { analyzer: 'kimi',   result: { url: 'u', dimensions: dimB } },
    ]);
    assert.ok(consensus.conflicts.find(c => c.field === 'transcript'), 'transcript 应冲突');
  });
});
