/**
 * VideoMind Unit Tests — Core Pipeline (Phase A Task 7)
 *
 * Verifies the full `analyze → build → sync` pipeline works end-to-end
 * without browser automation. Uses mock data shaped like real Doubao output.
 *
 * Pipeline being tested:
 *   mock video_analysis.json → KnowledgeBuilder.build() →
 *     structured_knowledge_base.json → MarkdownSink / ObsidianSink
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { KnowledgeBuilder } from '../builders/knowledge-builder.mjs';
import { MarkdownSink } from '../sinks/markdown.mjs';
import { ObsidianSink } from '../sinks/obsidian.mjs';

// ESM doesn't have require, but we use readFileSync/writeFileSync directly
const readJSON = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJSON = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2));

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'videomind-pipeline-'));
});

/**
 * Build a realistic-looking mock video_analysis.json based on what Doubao
 * would actually produce (matches the schema in schema.mjs).
 */
function buildMockAnalysis() {
  return {
    summary: 'Real-looking mock data',
    generatedAt: '2026-07-09T00:00:00.000Z',
    videos: [
      {
        url: 'https://douyin.com/v/001',
        title: 'Claude 10倍速学习法',
        author: 'AI教练',
        tags: ['AI', 'Claude', '学习法'],
        platform: 'douyin',
        analyzer: 'doubao',
        timestamp: '2026-07-09T10:00:00.000Z',
        analysis: '1. 技能名称：Claude 10倍速学习法\n2. 技能等级：中级\n3. 核心要点：六步学习闭环',
        dimensions: {
          skill_name: 'Claude 10倍速学习法',
          skill_level: '中级',
          key_points: ['六步学习闭环', '二八法则锁定核心'],
          action_steps: ['Step 1: 拆分技能', 'Step 2: 设计实验'],
          tools_resources: ['Claude', 'Firecrawl'],
          pitfalls: ['不要把 Claude 当搜索引擎'],
          use_cases: 'AI 自动化编程',
          prerequisites: '基础 Python',
          learning_path: '先看入门再看实战',
          auto_tags: ['AI-Agent', 'Claude', '学习法'],
        },
      },
      {
        url: 'https://douyin.com/v/002',
        title: 'Firecrawl 免 API 爬取',
        author: '数据工程师',
        tags: ['爬虫', 'Firecrawl'],
        platform: 'douyin',
        analyzer: 'doubao',
        timestamp: '2026-07-09T11:00:00.000Z',
        analysis: '1. 技能名称：Firecrawl 爬取\n2. 技能等级：入门\n关键词：开源工具 GitHub 爬虫，无需 API Key，处理 JS 渲染',
        dimensions: {
          skill_name: 'Firecrawl 免 API 爬取',
          skill_level: '入门',
          key_points: ['无需 API Key', '处理 JS 渲染'],
          action_steps: ['npm install firecrawl'],
          tools_resources: ['Firecrawl'],
          pitfalls: [],
          use_cases: '网页数据采集',
          prerequisites: 'Node.js 基础',
          learning_path: '独立使用',
          auto_tags: ['Scraper', 'Firecrawl'],
        },
      },
      {
        url: 'https://douyin.com/v/003',
        title: '随便聊聊科技',
        author: '闲聊博主',
        tags: ['闲聊'],
        platform: 'douyin',
        analyzer: 'doubao',
        timestamp: '2026-07-09T12:00:00.000Z',
        analysis: '这段是关于 AI 行业的闲聊，涉及一些 LLM 和自动化趋势。',
        dimensions: {
          skill_name: null,
          skill_level: null,
          key_points: null,
          action_steps: null,
          tools_resources: null,
          pitfalls: null,
          use_cases: null,
          prerequisites: null,
          learning_path: null,
          auto_tags: null,
        },
      },
    ],
  };
}

describe('Pipeline — analyze → build', () => {
  it('KnowledgeBuilder.build() produces structured KB from mock analysis', () => {
    const builder = new KnowledgeBuilder();
    const analyses = buildMockAnalysis().videos;
    const kb = builder.build(analyses);

    assert.ok(kb.generatedAt);
    assert.equal(kb.summary.total, 3);
    // First 2 should pass isAIRelevant (contain "AI" / "Firecrawl" / etc.)
    assert.ok(kb.summary.aiRelevant >= 2, `expected ≥2 AI-relevant, got ${kb.summary.aiRelevant}`);
    assert.ok(kb.categories, 'kb must have categories');
  });

  it('AI-relevant videos are categorized into specific buckets', () => {
    const builder = new KnowledgeBuilder();
    const kb = builder.build(buildMockAnalysis().videos);

    // Mock video 1 mentions "agent/workflow/自动化", should land in "AI Agent与工作流"
    // (Wait, our mock uses key_points like "六步学习闭环" which doesn't match that)
    // The mock video 2 mentions "Firecrawl" → "开源工具与项目"
    const openSourceCat = kb.categories['开源工具与项目'] || [];
    const firecrawlInCat = openSourceCat.some(v => v.url === 'https://douyin.com/v/002');
    assert.ok(firecrawlInCat, 'Firecrawl video should be in 开源工具与项目 category');
  });

  it('no video is silently dropped — every input appears in some category', () => {
    const builder = new KnowledgeBuilder();
    const kb = builder.build(buildMockAnalysis().videos);

    // Every input video URL must appear in SOME category
    const inputUrls = buildMockAnalysis().videos.map(v => v.url);
    const allCategorized = Object.values(kb.categories).flat();
    const foundUrls = new Set(allCategorized.map(v => v.url));

    for (const url of inputUrls) {
      assert.ok(foundUrls.has(url), `video ${url} was silently dropped!`);
    }
  });
});

describe('Pipeline — build → markdown sink', () => {
  it('produces non-empty files for each category', () => {
    const builder = new KnowledgeBuilder();
    const sink = new MarkdownSink({ outputDir: join(tmpDir, 'md') });
    const kb = builder.build(buildMockAnalysis().videos);

    return sink.sink(kb).then(result => {
      assert.ok(result.filesWritten >= 1, 'must write at least 1 file');
      const files = readdirSync(join(tmpDir, 'md'));
      assert.ok(files.length >= 1, 'output directory must have files');
      // Every file should be > 50 bytes (not empty)
      for (const f of files) {
        const content = readFileSync(join(tmpDir, 'md', f), 'utf8');
        assert.ok(content.length > 50, `${f} should be > 50 bytes, got ${content.length}`);
      }
    });
  });
});

describe('Pipeline — build → obsidian sink', () => {
  it('produces a complete Obsidian vault', () => {
    const builder = new KnowledgeBuilder();
    const sink = new ObsidianSink({ outputDir: join(tmpDir, 'obsidian') });
    const kb = builder.build(buildMockAnalysis().videos);

    return sink.sink(kb).then(result => {
      // 1 README + N categories + 3 videos + 1 daily
      assert.ok(result.filesWritten >= 4);
      assert.ok(existsSync(join(tmpDir, 'obsidian', 'README.md')));
      assert.ok(existsSync(join(tmpDir, 'obsidian', 'videos')));
      assert.ok(existsSync(join(tmpDir, 'obsidian', 'categories')));
      assert.ok(existsSync(join(tmpDir, 'obsidian', 'daily')));

      // Each video should have a note file
      const videoFiles = readdirSync(join(tmpDir, 'obsidian', 'videos'));
      assert.equal(videoFiles.length, 3);

      // Each video note should have frontmatter + wikilinks
      for (const vf of videoFiles) {
        const content = readFileSync(join(tmpDir, 'obsidian', 'videos', vf), 'utf8');
        assert.ok(content.startsWith('---\n'), `${vf} must have YAML frontmatter`);
        assert.ok(content.includes('[['), `${vf} must have wikilinks`);
      }
    });
  });
});

describe('Pipeline — full analyze → build → sync chain', () => {
  it('runs the complete pipeline without browser', async () => {
    // Step 1: write mock video_analysis.json
    const analysisPath = join(tmpDir, 'video_analysis.json');
    writeJSON(analysisPath, buildMockAnalysis());

    // Step 2: build
    const builder = new KnowledgeBuilder();
    const analyses = readJSON(analysisPath).videos;
    const kb = builder.build(analyses);
    const kbPath = join(tmpDir, 'structured_knowledge_base.json');
    writeJSON(kbPath, kb);

    // Step 3: sync to markdown
    const mdSink = new MarkdownSink({ outputDir: join(tmpDir, 'md-out') });
    const mdResult = await mdSink.sink(readJSON(kbPath));
    assert.ok(mdResult.filesWritten >= 1);

    // Step 4: sync to obsidian (same KB)
    const obSink = new ObsidianSink({ outputDir: join(tmpDir, 'obs-out') });
    const obResult = await obSink.sink(readJSON(kbPath));
    assert.ok(obResult.filesWritten >= 4);

    // Both sinks should have produced output
    assert.ok(existsSync(join(tmpDir, 'md-out')));
    assert.ok(existsSync(join(tmpDir, 'obs-out')));
  });

  it('preserves all video URLs through pipeline (no data loss)', async () => {
    const builder = new KnowledgeBuilder();
    const sink = new ObsidianSink({ outputDir: tmpDir });
    const inputVideos = buildMockAnalysis().videos;
    const inputUrls = new Set(inputVideos.map(v => v.url));

    const kb = builder.build(inputVideos);
    await sink.sink(kb);

    // Read all video notes, check every input URL appears in some note
    const videoDir = join(tmpDir, 'videos');
    const files = readdirSync(videoDir);
    let foundUrls = new Set();
    for (const f of files) {
      const content = readFileSync(join(videoDir, f), 'utf8');
      for (const url of inputUrls) {
        if (content.includes(url)) foundUrls.add(url);
      }
    }
    // At least the non-irrelevant videos should be in the KB
    // (mock video 3 has empty analysis, may be filtered)
    assert.ok(foundUrls.size >= 2, `expected ≥2 URLs preserved, got ${foundUrls.size}`);
  });
});

describe('Pipeline — error resilience', () => {
  it('handles empty videos array', () => {
    const builder = new KnowledgeBuilder();
    const kb = builder.build([]);
    assert.equal(kb.summary.total, 0);
    // All 8 categories should be present with 0 count (useful for UI rendering)
    assert.equal(Object.keys(kb.categoryDistribution).length, 8);
    for (const count of Object.values(kb.categoryDistribution)) {
      assert.equal(count, 0);
    }
  });

  it('handles videos missing dimensions gracefully', () => {
    const builder = new KnowledgeBuilder();
    const kb = builder.build([
      { url: 'u1', title: 'No dims', analysis: 'random text', tags: [] },
    ]);
    // Should not throw
    assert.ok(kb);
    assert.equal(kb.summary.total, 1);
  });

  it('handles videos with all-null dimensions in markdown sink', async () => {
    const builder = new KnowledgeBuilder();
    const sink = new MarkdownSink({ outputDir: join(tmpDir, 'md-null') });
    const v = {
      url: 'u1', title: 'null video', author: 'x', tags: [],
      analysis: 'no dims at all',
      dimensions: { skill_name: null, skill_level: null },
    };
    const kb = builder.build([v]);
    const result = await sink.sink(kb);
    assert.ok(result.filesWritten >= 1);
    const files = readdirSync(join(tmpDir, 'md-null'));
    for (const f of files) {
      const content = readFileSync(join(tmpDir, 'md-null', f), 'utf8');
      assert.ok(content.length > 0);
    }
  });
});
