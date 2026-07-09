/**
 * VideoMind Unit Tests — Core utility functions
 *
 * Tests the most critical utility functions that don't require
 * browser automation (extractTags, removeSimilarTitles, parseResponse).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── extractTags tests ───

// We need to import DouyinCollector just for the extractTags method
import { DouyinCollector } from '../collectors/douyin.mjs';

const collector = new DouyinCollector(null); // context not needed for extractTags

describe('DouyinCollector.extractTags', () => {
  it('extracts Chinese hashtags', () => {
    const tags = collector.extractTags('Python入门教程 #编程 #AI #自动化');
    assert.deepEqual(tags, ['编程', 'AI', '自动化']);
  });

  it('excludes pure numeric tags (#123)', () => {
    const tags = collector.extractTags('精彩视频 #123赞 真不错');
    assert.deepEqual(tags, []);
  });

  it('excludes single-character tags', () => {
    const tags = collector.extractTags('教程 #A #好视频');
    assert.deepEqual(tags, ['好视频']);
  });

  it('handles empty/null title', () => {
    assert.deepEqual(collector.extractTags(''), []);
    assert.deepEqual(collector.extractTags(null), []);
    assert.deepEqual(collector.extractTags(undefined), []);
  });

  it('handles mixed valid and invalid tags', () => {
    const tags = collector.extractTags('AI工具推荐 #AI-Agent #456 #爬虫 #开源 #K');
    assert.deepEqual(tags, ['AI-Agent', '爬虫', '开源']);
  });
});

// ─── removeSimilarTitles tests ───

import { KnowledgeBuilder } from '../builders/knowledge-builder.mjs';

const builder = new KnowledgeBuilder();

describe('KnowledgeBuilder.removeSimilarTitles', () => {
  it('keeps unique titles unchanged', () => {
    const videos = [
      { title: 'AI编程入门', url: 'url1', analysis: 'short' },
      { title: 'Python数据分析', url: 'url2', analysis: 'short' },
      { title: '开源工具推荐', url: 'url3', analysis: 'short' },
    ];
    const result = builder.removeSimilarTitles(videos);
    assert.equal(result.length, 3);
  });

  it('merges similar titles (>75% similarity)', () => {
    const videos = [
      { title: 'Claude 10倍速学习法', url: 'url1', analysis: 'long analysis here' },
      { title: 'Claude 10倍速学习法（增强版）', url: 'url2', analysis: 'short' },
    ];
    const result = builder.removeSimilarTitles(videos);
    assert.equal(result.length, 1);
    assert.equal(result[0].mergedUrls.length, 1);
    assert.equal(result[0].mergedUrls[0], 'url2');
  });

  it('does not merge dissimilar titles', () => {
    const videos = [
      { title: 'AI编程入门教程', url: 'url1' },
      { title: 'Python数据分析实战', url: 'url2' },
    ];
    const result = builder.removeSimilarTitles(videos);
    assert.equal(result.length, 2);
  });
});

// ─── parseResponse tests ───

import { DoubaoAnalyzer } from '../analyzers/doubao.mjs';

const analyzer = new DoubaoAnalyzer(null); // context not needed for parseResponse

describe('DoubaoAnalyzer.parseResponse', () => {
  it('extracts skill_name dimension', () => {
    const video = { url: 'https://douyin.com/v1', title: '测试视频', author: '作者A', tags: ['AI'] };
    const response = '1. 技能名称：Claude 10倍速学习法\n2. 技能等级：中级\n3. 核心要点：\n- 六步学习闭环\n- 二八法则锁定核心\n4. 实操步骤：Step 1: 拆分技能\n5. 工具/资源：Claude、Firecrawl\n6. 避坑指南：不要把Claude当搜索引擎\n7. 适用场景：AI自动化编程\n8. 前置知识：基础Python\n9. 学习路径：先看入门再看实操\n10. 关键词标签：#AI-Agent #学习法';

    const result = analyzer.parseResponse(video, response);
    assert.equal(result.dimensions.skill_name, 'Claude 10倍速学习法');
    assert.equal(result.dimensions.skill_level, '中级');
    assert.equal(result.dimensions.use_cases, 'AI自动化编程');
    assert.equal(result.dimensions.prerequisites, '基础Python');
    assert.equal(result.dimensions.learning_path, '先看入门再看实操');
  });

  it('extracts list dimensions', () => {
    const video = { url: 'https://douyin.com/v2', title: '测试2', author: '作者B', tags: [] };
    const response = '3. 核心要点：\n- 六步学习闭环\n- 二八法则锁定核心\n- Prompt分层设计\n\n4. 实操步骤：\n- Step 1: 拆分技能等级\n- Step 2: 设计实验方案\n\n5. 工具/资源：\n- Claude\n- Firecrawl\n- AgentChat';

    const result = analyzer.parseResponse(video, response);
    assert.ok(Array.isArray(result.dimensions.key_points));
    assert.ok(result.dimensions.key_points.length >= 2);
    assert.ok(Array.isArray(result.dimensions.tools_resources));
  });

  it('handles missing dimensions gracefully (returns null)', () => {
    const video = { url: 'https://douyin.com/v3', title: '测试3', author: '', tags: [] };
    const response = '这是一段完全没有结构化格式的文本输出。';

    const result = analyzer.parseResponse(video, response);
    // All dimensions should be null for unstructured text
    assert.equal(result.dimensions.skill_name, null);
    assert.equal(result.dimensions.skill_level, null);
    // But analysis text itself is preserved
    assert.equal(result.analysis, response);
  });

  it('extracts hashtag-style auto_tags', () => {
    const video = { url: 'v4', title: 't4', author: '', tags: [] };
    const response = '10. 关键词标签：#AI-Agent #爬虫 #开源工具';

    const result = analyzer.parseResponse(video, response);
    assert.deepEqual(result.dimensions.auto_tags, ['AI-Agent', '爬虫', '开源工具']);
  });
});
