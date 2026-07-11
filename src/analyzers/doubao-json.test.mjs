/**
 * VideoMind Unit Tests — Doubao JSON output (Phase A Task 8)
 *
 * Tests the dual-mode parser:
 * - Primary: tryParseJSON + buildResultFromJSON (preferred)
 * - Fallback: buildResultFromRegex (when model doesn't follow JSON instructions)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DoubaoAnalyzer } from './doubao.mjs';

const analyzer = new DoubaoAnalyzer(null); // no browser context needed

const baseVideo = {
  url: 'https://douyin.com/v/test',
  title: '测试视频',
  author: '作者A',
  tags: ['AI'],
};

describe('Doubao JSON parser — tryParseJSON', () => {
  it('parses raw JSON object', () => {
    const text = '{"skill_name": "X", "skill_level": "中级", "key_points": ["a", "b"]}';
    const result = analyzer.tryParseJSON(text);
    assert.equal(result.skill_name, 'X');
    assert.equal(result.skill_level, '中级');
    assert.deepEqual(result.key_points, ['a', 'b']);
  });

  it('parses JSON wrapped in ```json code block', () => {
    const text = '```json\n{"skill_name": "Y", "auto_tags": ["#t1", "#t2"]}\n```';
    const result = analyzer.tryParseJSON(text);
    assert.equal(result.skill_name, 'Y');
    assert.deepEqual(result.auto_tags, ['#t1', '#t2']);
  });

  it('parses JSON wrapped in plain ``` code block', () => {
    const text = '```\n{"skill_name": "Z"}\n```';
    const result = analyzer.tryParseJSON(text);
    assert.equal(result.skill_name, 'Z');
  });

  it('parses JSON with preamble text', () => {
    const text = '好的，以下是分析结果：\n{"skill_name": "P", "use_cases": "AI编程"}';
    const result = analyzer.tryParseJSON(text);
    assert.equal(result.skill_name, 'P');
    assert.equal(result.use_cases, 'AI编程');
  });

  it('parses JSON with trailing explanation', () => {
    const text = '{"skill_name": "Q", "skill_level": "高级"}\n\n以上是分析。';
    const result = analyzer.tryParseJSON(text);
    assert.equal(result.skill_name, 'Q');
    assert.equal(result.skill_level, '高级');
  });

  it('returns null for non-JSON text', () => {
    const text = '这是一段完全没有 JSON 的文本输出。';
    assert.equal(analyzer.tryParseJSON(text), null);
  });

  it('returns null for malformed JSON', () => {
    const text = '{"skill_name": "broken", missing_quotes: "x"';
    assert.equal(analyzer.tryParseJSON(text), null);
  });

  it('returns null for empty string', () => {
    assert.equal(analyzer.tryParseJSON(''), null);
    assert.equal(analyzer.tryParseJSON(null), null);
  });

  it('handles nested objects/arrays correctly', () => {
    const text = '{"skill_name": "N", "key_points": ["a", "b"], "extra": {"nested": true, "list": [1, 2]}}';
    const result = analyzer.tryParseJSON(text);
    assert.deepEqual(result.extra, { nested: true, list: [1, 2] });
  });

  it('handles Chinese strings with special chars (quotes, braces)', () => {
    const text = '{"skill_name": "用「Claude」做{智能}编程", "use_cases": "AI\\"分析\\""}';
    const result = analyzer.tryParseJSON(text);
    assert.equal(result.skill_name, '用「Claude」做{智能}编程');
    assert.equal(result.use_cases, 'AI"分析"');
  });
});

describe('Doubao JSON parser — extractBalancedJSON', () => {
  it('extracts first balanced {...}', () => {
    const text = '前面{"a": 1, "b": {"c": 2}}后面';
    assert.equal(analyzer.extractBalancedJSON(text), '{"a": 1, "b": {"c": 2}}');
  });

  it('handles braces inside strings', () => {
    const text = '前缀{"k": "value with } brace"}结束';
    assert.equal(analyzer.extractBalancedJSON(text), '{"k": "value with } brace"}');
  });

  it('handles escaped quotes inside strings', () => {
    const text = 'p{"k": "val\\"ue"}q';
    const result = analyzer.extractBalancedJSON(text);
    assert.ok(result);
    assert.ok(result.startsWith('{'));
  });

  it('returns null when no JSON present', () => {
    assert.equal(analyzer.extractBalancedJSON('no braces here'), null);
  });
});

describe('Doubao JSON parser — buildResultFromJSON', () => {
  it('produces full dimensions from complete JSON', () => {
    const parsed = {
      skill_name: 'Claude 10倍速学习法',
      skill_level: '中级',
      key_points: ['六步学习闭环', '二八法则'],
      action_steps: ['Step 1: 拆分技能', 'Step 2: 实验'],
      tools_resources: ['Claude', 'Firecrawl'],
      pitfalls: ['不要当搜索引擎'],
      use_cases: 'AI 自动化编程',
      prerequisites: '基础 Python',
      learning_path: '先看入门再看实战',
      auto_tags: ['#AI-Agent', '#Claude', '#学习法'],
    };
    const result = analyzer.buildResultFromJSON(baseVideo, 'raw text', parsed);

    assert.equal(result.parseMode, 'json');
    assert.equal(result.dimensions.skill_name, 'Claude 10倍速学习法');
    assert.deepEqual(result.dimensions.key_points, ['六步学习闭环', '二八法则']);
    assert.deepEqual(result.dimensions.action_steps, ['Step 1: 拆分技能', 'Step 2: 实验']);
    assert.equal(result.dimensions.skill_level, '中级');
    assert.equal(result.analysis, 'raw text'); // original preserved
  });

  it('handles missing dimensions gracefully (returns null)', () => {
    const parsed = { skill_name: 'X' }; // only one field
    const result = analyzer.buildResultFromJSON(baseVideo, '', parsed);
    assert.equal(result.dimensions.skill_name, 'X');
    assert.equal(result.dimensions.skill_level, null);
    assert.equal(result.dimensions.key_points, null);
  });

  it('converts empty arrays to null', () => {
    const parsed = { skill_name: 'X', key_points: [], action_steps: [] };
    const result = analyzer.buildResultFromJSON(baseVideo, '', parsed);
    assert.equal(result.dimensions.key_points, null);
    assert.equal(result.dimensions.action_steps, null);
  });

  it('normalizes auto_tags: strips leading # and dedupes', () => {
    const parsed = { auto_tags: ['#AI', 'AI', '#Claude', 'claude', '#AI'] };
    const result = analyzer.buildResultFromJSON(baseVideo, '', parsed);
    assert.deepEqual(result.dimensions.auto_tags, ['AI', 'Claude']);
  });

  it('handles empty auto_tags gracefully', () => {
    const parsed = { auto_tags: [] };
    const result = analyzer.buildResultFromJSON(baseVideo, '', parsed);
    assert.equal(result.dimensions.auto_tags, null);
  });

  it('trims whitespace from string values', () => {
    const parsed = { skill_name: '  X  ', skill_level: '\t中级\n' };
    const result = analyzer.buildResultFromJSON(baseVideo, '', parsed);
    assert.equal(result.dimensions.skill_name, 'X');
    assert.equal(result.dimensions.skill_level, '中级');
  });
});

describe('Doubao JSON parser — parseResponse dual mode', () => {
  it('uses JSON path when response is valid JSON', () => {
    const jsonResp = JSON.stringify({
      skill_name: 'J',
      skill_level: '中级',
      key_points: ['a'],
      auto_tags: ['#t'],
    });
    const result = analyzer.parseResponse(baseVideo, jsonResp);
    assert.equal(result.parseMode, 'json');
    assert.equal(result.dimensions.skill_name, 'J');
    assert.deepEqual(result.dimensions.key_points, ['a']);
    assert.deepEqual(result.dimensions.auto_tags, ['t']);
  });

  it('falls back to regex when JSON is invalid', () => {
    const regexResp = `1. 技能名称：Regex Skill
2. 技能等级：入门
3. 核心要点：
- 第一点
- 第二点
10. 关键词标签：#AI #测试`;

    const result = analyzer.parseResponse(baseVideo, regexResp);
    assert.equal(result.parseMode, 'regex');
    assert.equal(result.dimensions.skill_name, 'Regex Skill');
    assert.deepEqual(result.dimensions.key_points, ['第一点', '第二点']);
  });

  it('falls back to regex for fully unstructured text', () => {
    const result = analyzer.parseResponse(baseVideo, '完全没有结构化的文本输出');
    assert.equal(result.parseMode, 'regex');
    assert.equal(result.dimensions.skill_name, null);
  });

  it('preserves original raw text in analysis field either way', () => {
    const text1 = '{"skill_name": "X"}';
    const text2 = '1. 技能名称：Y';

    const r1 = analyzer.parseResponse(baseVideo, text1);
    const r2 = analyzer.parseResponse(baseVideo, text2);

    assert.equal(r1.analysis, text1);
    assert.equal(r2.analysis, text2);
  });

  it('handles JSON wrapped in markdown code block', () => {
    const text = '下面是结果：\n```json\n{"skill_name": "M", "auto_tags": ["#md"]}\n```\n希望对你有帮助。';
    const result = analyzer.parseResponse(baseVideo, text);
    assert.equal(result.parseMode, 'json');
    assert.equal(result.dimensions.skill_name, 'M');
    assert.deepEqual(result.dimensions.auto_tags, ['md']);
  });
});

describe('Doubao JSON parser — buildPrompt updates', () => {
  it('prompt includes JSON format instruction', () => {
    const prompt = analyzer.buildPrompt(baseVideo);
    assert.ok(prompt.includes('JSON'), 'prompt should mention JSON');
    assert.ok(prompt.includes('skill_name'), 'prompt should specify JSON schema fields');
    assert.ok(prompt.includes('"严格 JSON"') || prompt.includes('仅'), 'prompt should demand JSON-only output');
    assert.ok(prompt.includes('不要使用 markdown 代码块包裹') || prompt.includes('不'), 'prompt should forbid markdown wrapping');
  });

  it('prompt still includes original 10-dimension requirements', () => {
    const prompt = analyzer.buildPrompt(baseVideo);
    assert.ok(prompt.includes('技能名称'));
    assert.ok(prompt.includes('技能等级'));
    assert.ok(prompt.includes('核心要点'));
    assert.ok(prompt.includes('关键词标签'));
  });
});

describe('Doubao JSON parser — stringOrNull / arrayOrNull', () => {
  it('stringOrNull trims and handles null/empty', () => {
    assert.equal(analyzer.stringOrNull('  hello  '), 'hello');
    assert.equal(analyzer.stringOrNull(''), null);
    assert.equal(analyzer.stringOrNull(null), null);
    assert.equal(analyzer.stringOrNull(undefined), null);
    assert.equal(analyzer.stringOrNull(123), '123');
  });

  it('arrayOrNull filters empty/whitespace entries', () => {
    assert.deepEqual(analyzer.arrayOrNull(['a', '  ', 'b']), ['a', 'b']);
    assert.deepEqual(analyzer.arrayOrNull(['  ', '']), null);
    assert.equal(analyzer.arrayOrNull(null), null);
    assert.equal(analyzer.arrayOrNull('not an array'), null);
  });
});