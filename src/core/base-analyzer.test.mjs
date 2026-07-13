/**
 * VideoMind Unit Tests — BaseAnalyzer (Round 17)
 *
 * 测的是 base-analyzer 抽象层:
 * - M1 transcript 提取 (3 模式: JSON 字段 / 字面行 / 缺失)
 * - JSON parse + dimension build (含 transcript 字段)
 * - Regex parse + dimension build (含 transcript 字段)
 * - tryParseJSON 三段解析 (直接 / code block / balanced)
 * - normalizeTags 去重 + # 剥离
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BaseAnalyzer } from './base-analyzer.mjs';

/* ============================================================
 * extractTranscript — M1 transcript 兜底提取
 * ============================================================ */

describe('BaseAnalyzer.extractTranscript', () => {
  test('JSON 风格 "transcript": "..." 字段', () => {
    const a = makeBare();
    const text = '{"skill_name":"x","transcript":"这是一段视频转录内容 够长够长够长够长"}';
    const got = a.extractTranscript(text);
    assert.ok(got, '应提取到');
    assert.match(got, /视频转录/);
  });

  test('中文标点 : 也能匹配', () => {
    const a = makeBare();
    const text = '{"skill_name":"x","transcript":"逐字记录测试内容够长够长够长够长"}';
    assert.match(a.extractTranscript(text), /逐字记录/);
  });

  test('字面行: "语音转写: ..."', () => {
    const a = makeBare();
    const text = `## 语音转写
本视频讲三个核心方法,每个方法都用实例说明。

## 核心要点
1. ...`;
    const got = a.extractTranscript(text);
    assert.ok(got, '应从字面行提取');
    assert.match(got, /三个核心方法/);
  });

  test('Transcript 英文标题也行', () => {
    const a = makeBare();
    const text = `## Transcript
The video explains three key methods, each method has examples.
## Next`;
    const got = a.extractTranscript(text);
    assert.match(got, /three key methods/);
  });

  test('缺失 transcript 信号返回 null', () => {
    const a = makeBare();
    const text = '## 技能名称\n某技能\n## 核心要点\n- 要点1\n- 要点2';
    assert.equal(a.extractTranscript(text), null);
  });

  test('空 / null rawText 安全返回 null', () => {
    const a = makeBare();
    assert.equal(a.extractTranscript(''), null);
    assert.equal(a.extractTranscript(null), null);
    assert.equal(a.extractTranscript(undefined), null);
  });

  test('短字段不被噪音触发 (< 20 字符)', () => {
    const a = makeBare();
    assert.equal(a.extractTranscript('transcript: x'), null);
    assert.equal(a.extractTranscript('语音转写: 短'), null);
  });
});

/* ============================================================
 * buildResultFromJSON + transcript 维度
 * ============================================================ */

describe('BaseAnalyzer.buildResultFromJSON 含 transcript', () => {
  test('parse 11 维度 (含 transcript)', () => {
    const a = makeBare({ platform: 'test' });
    const json = JSON.stringify({
      skill_name: '测试技能',
      skill_level: '入门',
      key_points: ['点1'],
      action_steps: ['步骤1'],
      tools_resources: ['工具1'],
      pitfalls: ['坑1'],
      use_cases: '场景1',
      prerequisites: '前知1',
      learning_path: '路径1',
      auto_tags: ['#AI', '#测试'],
      transcript: '这是视频转录内容,够长够长够长够长'
    });
    const parsed = JSON.parse(json);
    const result = a.buildResultFromJSON({ url: 'x', title: 't' }, json, parsed);
    assert.equal(result.dimensions.transcript, '这是视频转录内容,够长够长够长够长');
    assert.equal(result.dimensions.skill_name, '测试技能');
    assert.equal(result.parseMode, 'json');
    assert.equal(result.analyzer, 'test');
  });

  test('无 transcript 字段时返回 null (不是 undefined)', () => {
    const a = makeBare({ platform: 'test' });
    const parsed = { skill_name: 'x', key_points: ['y'] };
    const result = a.buildResultFromJSON({ url: 'x' }, 'raw', parsed);
    assert.equal(result.dimensions.transcript, null);
  });
});

/* ============================================================
 * buildResultFromRegex + transcript 兜底
 * ============================================================ */

describe('BaseAnalyzer.buildResultFromRegex 含 transcript', () => {
  test('regex 兜底 transcript 提取', () => {
    const a = makeBare({ platform: 'test' });
    const text = `
## 1. 技能名称
测试技能

## 2. 技能等级
入门

## 3. 核心要点
- 要点1
- 要点2

## 4. 实操步骤
- 步骤1

## 5. 工具/资源
- 工具1

## 6. 避坑指南
- 坑1

## 7. 适用场景
场景1

## 8. 前置知识
前知1

## 9. 学习路径
路径1

## 10. 关键词标签
#AI #测试

## 语音转写
本视频讲三个核心方法,每个方法都用实例说明。
    `;
    const result = a.buildResultFromRegex({ url: 'x', title: 't' }, text);
    assert.ok(result.dimensions.transcript, 'regex 应抓到 transcript');
    assert.match(result.dimensions.transcript, /三个核心方法/);
    assert.equal(result.parseMode, 'regex');
  });
});

/* ============================================================
 * tryParseJSON 三段解析
 * ============================================================ */

describe('BaseAnalyzer.tryParseJSON', () => {
  test('直接 JSON.parse', () => {
    const a = makeBare();
    const got = a.tryParseJSON('{"skill_name":"x"}');
    assert.equal(got.skill_name, 'x');
  });

  test('code block JSON', () => {
    const a = makeBare();
    const got = a.tryParseJSON('看这里:\n```json\n{"skill_name":"x","transcript":"y"}\n```\n结束');
    assert.equal(got.skill_name, 'x');
    assert.equal(got.transcript, 'y');
  });

  test('balanced JSON 提取 (前缀废话 + 后缀)', () => {
    const a = makeBare();
    const got = a.tryParseJSON('前缀废话{"skill_name":"x","transcript":"y"}后缀废话');
    assert.equal(got.skill_name, 'x');
    assert.equal(got.transcript, 'y');
  });

  test('空 / 无效 返回 null', () => {
    const a = makeBare();
    assert.equal(a.tryParseJSON(''), null);
    assert.equal(a.tryParseJSON('not json at all'), null);
    assert.equal(a.tryParseJSON(null), null);
  });
});

/* ============================================================
 * normalizeTags
 * ============================================================ */

describe('BaseAnalyzer.normalizeTags', () => {
  test('剥离 # 前缀', () => {
    const a = makeBare();
    assert.deepEqual(a.normalizeTags(['#AI', '#测试']), ['AI', '测试']);
  });

  test('去重大小写', () => {
    const a = makeBare();
    assert.deepEqual(a.normalizeTags(['#AI', '#ai', 'AI']), ['AI']);
  });

  test('空数组 / 非数组 返回 null', () => {
    const a = makeBare();
    assert.equal(a.normalizeTags([]), null);
    assert.equal(a.normalizeTags(null), null);
    assert.equal(a.normalizeTags('not array'), null);
  });

  test('过滤空字符串', () => {
    const a = makeBare();
    assert.deepEqual(a.normalizeTags(['#AI', '', '#', '  ']), ['AI']);
  });
});

/* ============================================================
 * Helper
 * ============================================================ */

function makeBare(opts = {}) {
  return new BaseAnalyzer({}, {
    platform: opts.platform || 'test',
    logger: {
      warn() {}, debug() {}, info() {}, error() {},
      child() { return this; }
    }
  });
}
