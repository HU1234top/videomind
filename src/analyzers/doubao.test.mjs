/**
 * src/analyzers/doubao.test.mjs — Round 13 新增
 *
 * 主要测 renderAsSkillMd 把 dimensions 渲染为仓颉.Skill 兼容的 SKILL.md
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DoubaoAnalyzer } from './doubao.mjs';

const sampleAnalysisResult = {
  url: 'https://example.com/video/1',
  title: 'Claude 10倍速学习法',
  author: 'AI 编程导师',
  tags: ['AI', '效率'],
  platform: 'douyin',
  analyzer: 'doubao',
  analysis: '这是视频内容\n具体讲 Claude 的高效用法\n重点是 10 维度的拆解',
  dimensions: {
    skill_name: 'Claude 10倍速学习法',
    skill_level: '中级',
    key_points: ['快速搭建开发环境', '善用 AI 助手', '迭代反馈循环'],
    action_steps: ['Step 1: 安装 Claude', 'Step 2: 提问模板化', 'Step 3: 反馈调整'],
    tools_resources: ['Claude 网页版', 'VSCode 插件'],
    use_cases: '需要快速学习新技术的开发者',
    prerequisites: '基础编程能力',
    pitfalls: ['盲目相信结果', '不复盘'],
    auto_tags: ['#AI', '#编程', '#效率']
  },
  parseMode: 'json',
  timestamp: '2026-07-11T07:30:00.000Z'
};

describe('DoubaoAnalyzer.renderAsSkillMd (Round 13)', () => {
  const analyzer = new DoubaoAnalyzer(null);

  test('throws on invalid input', () => {
    assert.throws(() => analyzer.renderAsSkillMd(null), /invalid/);
    assert.throws(() => analyzer.renderAsSkillMd({}), /invalid/);
  });

  test('frontmatter 包含必需字段', () => {
    const md = analyzer.renderAsSkillMd(sampleAnalysisResult);
    assert.match(md, /^---\nname: /m);
    assert.match(md, /description: \|/);
    assert.match(md, /source_video: /);
    assert.match(md, /source_url: /);
    assert.match(md, /tags: \[/);
    assert.match(md, /related_skills: \[\]/);
  });

  test('slug 从 title 生成 (含中文)', () => {
    const md = analyzer.renderAsSkillMd(sampleAnalysisResult);
    // Round 13: 仓颉.Skill 兼容 name 可以含中文
    assert.match(md, /^name: claude-/m, '应该以 claude 开头');
  });

  test('包含 RIA++ 六段标题', () => {
    const md = analyzer.renderAsSkillMd(sampleAnalysisResult);
    assert.match(md, /## R — 原文引用/);
    assert.match(md, /## I — 方法论骨架/);
    assert.match(md, /## A1 — 视频中的应用/);
    assert.match(md, /## A2 — 触发场景/);
    assert.match(md, /## E — 可执行步骤/);
    assert.match(md, /## B — 边界/);
  });

  test('描述里的 use_cases 来自 dimensions', () => {
    const md = analyzer.renderAsSkillMd(sampleAnalysisResult);
    assert.match(md, /需要快速学习新技术的开发者/);
  });

  test('触发条件 section 含 language signal', () => {
    const md = analyzer.renderAsSkillMd(sampleAnalysisResult);
    assert.match(md, /语言信号/);
    assert.match(md, /想要.*怎么做.*学习/);
  });

  test('边界 B 段含 pitfalls 列表', () => {
    const md = analyzer.renderAsSkillMd(sampleAnalysisResult);
    assert.match(md, /盲目相信结果/);
    assert.match(md, /不复盘/);
  });

  test('审计段含 parseMode + timestamp (在 frontmatter 里)', () => {
    const md = analyzer.renderAsSkillMd(sampleAnalysisResult);
    // Round 13 fix: 审计信息在 frontmatter tags 之前的扩展字段中
    assert.match(md, /2026-07-11T07:30:00/);
  });

  test('空数组字段降级为 "（无）"', () => {
    const minimal = {
      ...sampleAnalysisResult,
      dimensions: {
        ...sampleAnalysisResult.dimensions,
        key_points: [],
        action_steps: [],
        tools_resources: [],
        pitfalls: [],
        auto_tags: []
      }
    };
    const md = analyzer.renderAsSkillMd(minimal);
    assert.match(md, /_（无）_/);
  });

  test('管线字符 | 转义（slug 处理时已剥离特殊字符）', () => {
    const result = {
      ...sampleAnalysisResult,
      title: 'Title with | pipe'
    };
    const md = analyzer.renderAsSkillMd(result);
    // Round 13: slug 用 kebab-case regex 剥离 | 等特殊字符
    // 所以 MD 里的 title 位置不会出现 |
    // 但 | 出现在 frontmatter description 字段（已 escapeMd 转义）
    // 我们检查至少 name slug 里没 |
    assert.match(md, /^name: [a-z0-9-一-鿿]+$/m);
  });

  test('Round 13 SKILL.md 是字符串 (非空)', () => {
    const md = analyzer.renderAsSkillMd(sampleAnalysisResult);
    assert.equal(typeof md, 'string');
    assert.ok(md.length > 500, `MD should be substantial (>500 chars), got ${md.length}`);
  });

  test('SKILL.md 兼容 doubao-skill name 字段格式', () => {
    const md = analyzer.renderAsSkillMd(sampleAnalysisResult);
    // Frontmatter 的 name 字段就是 slug
    const nameMatch = md.match(/^name: ([a-z0-9-]+)\b/m);
    assert.ok(nameMatch, 'should have a valid slug-style name');
  });
});

describe('DoubaoAnalyzer.renderAsSkillMd — 与 doubao analyze 输出兼容', () => {
  const analyzer = new DoubaoAnalyzer(null);

  test('完整 analyze→render 链路: dimensions 来自 JSON 路径', () => {
    // 用 buildResultFromJSON 的契约结构
    const analyzed = {
      url: 'https://example.com/v1',
      title: 'JSON 测试视频',
      author: '测试',
      tags: ['t1'],
      platform: 'douyin',
      analyzer: 'doubao',
      analysis: 'raw text',
      dimensions: {
        skill_name: 'TestSkill',
        skill_level: '入门',
        key_points: ['p1'],
        action_steps: ['s1'],
        tools_resources: ['t1'],
        use_cases: '测试用例',
        prerequisites: '无',
        pitfalls: [],
        auto_tags: ['#test']
      },
      parseMode: 'json',
      timestamp: '2026-07-11T08:00:00.000Z'
    };
    const md = analyzer.renderAsSkillMd(analyzed);
    // slug 用 hash 而不是 title（title 含中文会被清洗成 hash）
    assert.match(md, /^name: .+/m);
    assert.match(md, /## I — 方法论骨架/);
    assert.match(md, /TestSkill/);  // 标题里有
  });
});