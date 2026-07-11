/**
 * src/analyzers/kimi.test.mjs — KimiAnalyzer 单测
 *
 * 测试重点（与 doubao-json.test.mjs 同模式）：
 *   1. 构造接受 logger 注入
 *   2. buildPrompt 输出包含视频元数据 + 10 维度框架
 *   3. parseResponse: JSON 优先，regex 降级
 *   4. tryParseJSON 三段防御
 *   5. extractBalancedJSON 处理嵌套 + 字符串转义
 *   6. buildResultFromJSON 字段归一化
 *   7. buildResultFromRegex 兜底
 *   8. analyzer 字段 "kimi"（不是 "doubao"）
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { KimiAnalyzer } from './kimi.mjs';

const sampleVideo = {
  url: 'https://www.douyin.com/video/7123456789',
  title: '如何用 Claude 10倍速学习编程',
  author: 'AI 编程导师',
  tags: ['AI', '编程', '效率'],
  comments: ['讲得好', { author: '用户A', text: '太实用了' }],
  transcript: '本视频讲三个核心方法...'
};

describe('KimiAnalyzer — construction', () => {
  test('accepts logger injection', () => {
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => logger };
    const analyzer = new KimiAnalyzer(null, { logger });
    assert.equal(analyzer.logger, logger);
  });

  test('default logger from createLogger', () => {
    const analyzer = new KimiAnalyzer(null);
    assert.ok(analyzer.logger);
  });

  test('uses kimi URL', () => {
    const analyzer = new KimiAnalyzer(null);
    assert.equal(analyzer.url, 'https://www.kimi.com/');
  });

  test('loads selectors from selectors/kimi.json', () => {
    const analyzer = new KimiAnalyzer(null);
    assert.ok(analyzer.selectors);
    assert.ok(analyzer.selectors.chatInput);
    assert.ok(analyzer.selectors.sendButton);
    assert.ok(analyzer.selectors.responseContainer);
  });
});

describe('KimiAnalyzer.buildPrompt', () => {
  const analyzer = new KimiAnalyzer(null);

  test('Round 10 终极简化: prompt 就是 URL + 一句话 (用户原话)', () => {
    const prompt = analyzer.buildPrompt(sampleVideo);
    // 不再堆叠元数据、不再要 JSON 结构化
    assert.match(prompt, /https:\/\/www\.douyin\.com\/video\/7123456789/);
    assert.match(prompt, /帮我详细分析这个视频/);
  });

  test('prompt is very short (< 200 chars)', () => {
    const prompt = analyzer.buildPrompt(sampleVideo);
    assert.ok(prompt.length < 200, `prompt too long: ${prompt.length} chars (should be ~50)`);
  });

  test('prompt does NOT include 10-dimension framework (Kimi 自由发挥)', () => {
    const prompt = analyzer.buildPrompt(sampleVideo);
    assert.doesNotMatch(prompt, /技能名称/);
    assert.doesNotMatch(prompt, /JSON/);
  });
});

describe('KimiAnalyzer.tryParseJSON', () => {
  const analyzer = new KimiAnalyzer(null);

  test('parses raw JSON', () => {
    const text = '{"skill_name":"测试","skill_level":"入门"}';
    const result = analyzer.tryParseJSON(text);
    assert.deepEqual(result, { skill_name: '测试', skill_level: '入门' });
  });

  test('parses markdown code block JSON', () => {
    const text = '```json\n{"skill_name":"测试","skill_level":"入门"}\n```';
    const result = analyzer.tryParseJSON(text);
    assert.deepEqual(result, { skill_name: '测试', skill_level: '入门' });
  });

  test('parses preamble + JSON', () => {
    const text = '分析结果如下：\n{"skill_name":"测试","skill_level":"入门"}';
    const result = analyzer.tryParseJSON(text);
    assert.deepEqual(result, { skill_name: '测试', skill_level: '入门' });
  });

  test('returns null on garbage', () => {
    assert.equal(analyzer.tryParseJSON('not json at all'), null);
    assert.equal(analyzer.tryParseJSON(''), null);
    assert.equal(analyzer.tryParseJSON(null), null);
  });
});

describe('KimiAnalyzer.extractBalancedJSON', () => {
  const analyzer = new KimiAnalyzer(null);

  test('handles nested braces', () => {
    const text = '{"a":{"b":{"c":1}},"d":2}';
    const result = analyzer.extractBalancedJSON(text);
    assert.equal(JSON.parse(result).a.b.c, 1);
    assert.equal(JSON.parse(result).d, 2);
  });

  test('handles strings with braces', () => {
    const text = '{"msg":"hello {world}","x":1}';
    const result = analyzer.extractBalancedJSON(text);
    assert.equal(JSON.parse(result).msg, 'hello {world}');
  });

  test('handles escaped quotes', () => {
    const text = '{"msg":"he said \\"hi\\"","x":1}';
    const result = analyzer.extractBalancedJSON(text);
    assert.equal(JSON.parse(result).msg, 'he said "hi"');
  });

  test('returns null on no opening brace', () => {
    assert.equal(analyzer.extractBalancedJSON('no json here'), null);
  });
});

describe('KimiAnalyzer.buildResultFromJSON', () => {
  const analyzer = new KimiAnalyzer(null);

  test('normalizes all 10 dimensions', () => {
    const parsed = {
      skill_name: '测试技能',
      skill_level: '中级',
      key_points: ['要点1', '要点2'],
      action_steps: ['步骤1'],
      tools_resources: ['工具A'],
      pitfalls: ['坑1'],
      use_cases: '场景X',
      prerequisites: '需要Y基础',
      learning_path: '组合学习Z',
      auto_tags: ['#AI', '#编程']
    };
    const result = analyzer.buildResultFromJSON(sampleVideo, 'raw text', parsed);
    assert.equal(result.url, sampleVideo.url);
    assert.equal(result.title, sampleVideo.title);
    assert.equal(result.analyzer, 'kimi');
    assert.equal(result.platform, 'douyin');
    assert.equal(result.parseMode, 'json');
    assert.equal(result.dimensions.skill_name, '测试技能');
    assert.equal(result.dimensions.skill_level, '中级');
    assert.deepEqual(result.dimensions.key_points, ['要点1', '要点2']);
    assert.ok(result.timestamp);
  });

  test('strips # from auto_tags and dedupes', () => {
    const parsed = {
      skill_name: 'X', skill_level: '入门',
      key_points: [], action_steps: [], tools_resources: [], pitfalls: [],
      use_cases: '', prerequisites: '', learning_path: '',
      auto_tags: ['AI', '#AI', '编程', '#AI']  // duplicate
    };
    const result = analyzer.buildResultFromJSON(sampleVideo, '', parsed);
    assert.deepEqual(result.dimensions.auto_tags, ['#AI', '#编程']);
  });

  test('null fields produce null', () => {
    const parsed = { skill_name: 'only name' };
    const result = analyzer.buildResultFromJSON(sampleVideo, '', parsed);
    assert.equal(result.dimensions.skill_name, 'only name');
    assert.equal(result.dimensions.skill_level, null);
    assert.equal(result.dimensions.key_points, null);
  });
});

describe('KimiAnalyzer.buildResultFromRegex', () => {
  const analyzer = new KimiAnalyzer(null);

  test('extracts 10 dimensions from markdown-style output', () => {
    // 注意: regex 提取需要每个 dimension 后面有明确 "下一节" 边界才能切
    const text = `1. **技能名称**: Kimi 高效使用
2. **技能等级**: 入门
3. **核心要点**:
- 要点 A
- 要点 B
- 要点 C
4. **实操步骤**:
- 步骤 1: 打开 Kimi
- 步骤 2: 输入 prompt
5. **工具/资源**: Kimi 网页版
6. **避坑指南**: 注意输入长度
7. **适用场景**: 日常写作辅助
8. **前置知识**: 无
9. **学习路径**: 配合 Claude 学习
10. **关键词标签**: #AI #Kimi #效率`;
    const result = analyzer.buildResultFromRegex(sampleVideo, text);
    assert.equal(result.parseMode, 'regex');
    assert.equal(result.analyzer, 'kimi');
    assert.equal(result.dimensions.skill_name, 'Kimi 高效使用');
    assert.equal(result.dimensions.skill_level, '入门');
    assert.deepEqual(result.dimensions.key_points, ['要点 A', '要点 B', '要点 C']);
    assert.equal(result.dimensions.action_steps.length, 2);
    assert.ok(Array.isArray(result.dimensions.tools_resources));
    assert.match(result.dimensions.tools_resources.join(' '), /Kimi/);
    assert.ok(Array.isArray(result.dimensions.pitfalls));
    assert.match(result.dimensions.pitfalls.join(' '), /输入长度/);
    assert.match(result.dimensions.use_cases, /写作/);
    assert.match(result.dimensions.prerequisites, /无/);
    assert.match(result.dimensions.learning_path, /Claude/);
    assert.deepEqual(result.dimensions.auto_tags, ['#AI', '#Kimi', '#效率']);
  });
});

describe('KimiAnalyzer.parseResponse', () => {
  const analyzer = new KimiAnalyzer(null);

  test('prefers JSON when valid', () => {
    const text = '{"skill_name":"JSON 路径","skill_level":"中级","key_points":["p"],"action_steps":[],"tools_resources":[],"pitfalls":[],"use_cases":"","prerequisites":"","learning_path":"","auto_tags":[]}';
    const result = analyzer.parseResponse(sampleVideo, text);
    assert.equal(result.parseMode, 'json');
    assert.equal(result.dimensions.skill_name, 'JSON 路径');
  });

  test('falls back to regex when JSON invalid', () => {
    const text = '1. **技能名称**: Regex 路径\n2. **技能等级**: 入门';
    const result = analyzer.parseResponse(sampleVideo, text);
    assert.equal(result.parseMode, 'regex');
    assert.equal(result.dimensions.skill_name, 'Regex 路径');
  });
});

describe('KimiAnalyzer — public API contract', () => {
  test('class is named KimiAnalyzer', () => {
    const analyzer = new KimiAnalyzer(null);
    assert.equal(analyzer.constructor.name, 'KimiAnalyzer');
  });

  test('analyze method exists', () => {
    const analyzer = new KimiAnalyzer(null);
    assert.equal(typeof analyzer.analyze, 'function');
  });

  test('result has analyzer=kimi (NOT doubao)', () => {
    const analyzer = new KimiAnalyzer(null);
    const parsed = { skill_name: 'X' };
    const result = analyzer.buildResultFromJSON(sampleVideo, '', parsed);
    assert.equal(result.analyzer, 'kimi');
  });
});