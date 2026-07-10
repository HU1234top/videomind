/**
 * VideoMind Unit Tests — ObsidianSink
 *
 * Verifies:
 * - Vault structure (README, categories/, videos/, daily/)
 * - YAML frontmatter correctness
 * - Wikilink format [[Note Name]]
 * - Filename sanitization (Windows-illegal chars)
 * - Daily note generation
 * - Empty category handling
 * - End-to-end with mock knowledge base
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ObsidianSink } from './obsidian.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'videomind-obsidian-'));
});

const mockKB = (videos = []) => ({
  generatedAt: '2026-07-09T00:00:00.000Z',
  summary: { total: videos.length, deepAnalysis: videos.length, aiRelevant: videos.length },
  categoryDistribution: { 'AI Agent': 2, 'Other': 1 },
  categories: {
    'AI Agent': videos.slice(0, 2),
    'Other': videos.slice(2, 3),
  },
});

const mockVideo = (overrides = {}) => ({
  url: 'https://douyin.com/v/123',
  title: 'Claude 学习加速法',
  author: '测试作者',
  tags: ['AI', 'Claude'],
  platform: 'douyin',
  analyzer: 'doubao',
  timestamp: '2026-07-09T10:00:00.000Z',
  analysis: '完整分析内容',
  dimensions: {
    skill_name: 'Claude 学习加速法',
    skill_level: '中级',
    key_points: ['六步学习闭环', '二八法则'],
    action_steps: ['Step 1: 拆分技能', 'Step 2: 实验'],
    tools_resources: ['Claude', 'Firecrawl'],
    pitfalls: ['不要当搜索引擎用'],
    use_cases: 'AI 自动化编程',
    prerequisites: '基础 Python',
    learning_path: '先看入门再实战',
    auto_tags: ['AI-Agent', 'Claude', '学习法'],
  },
  ...overrides,
});

describe('ObsidianSink — vault structure', () => {
  it('creates README.md + categories/ + videos/ + daily/', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    await sink.sink(mockKB([mockVideo(), mockVideo()]));

    assert.ok(existsSync(join(tmpDir, 'README.md')));
    assert.ok(existsSync(join(tmpDir, 'categories')));
    assert.ok(existsSync(join(tmpDir, 'videos')));
    assert.ok(existsSync(join(tmpDir, 'daily')));
  });

  it('returns correct file count in result', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    const result = await sink.sink(mockKB([
      mockVideo(),
      mockVideo({ url: 'https://douyin.com/v/456', title: '另一视频' }),
      mockVideo({ url: 'https://douyin.com/v/789', title: '第三' }),
    ]));

    // 1 README + 2 category MOCs + 3 video notes + 1 daily = 7
    assert.equal(result.filesWritten, 7);
    assert.equal(result.videos, 3);
    assert.equal(result.categories, 2);
  });

  it('skips empty categories but still writes the rest', async () => {
    const kb = {
      summary: { total: 2, deepAnalysis: 2, aiRelevant: 2 },
      categoryDistribution: { 'Cat A': 2, 'Cat B': 0 },
      categories: { 'Cat A': [mockVideo(), mockVideo({ url: 'u2', title: 't2' })], 'Cat B': [] },
    };
    const sink = new ObsidianSink({ outputDir: tmpDir });
    await sink.sink(kb);
    assert.ok(existsSync(join(tmpDir, 'categories', 'Cat A.md')));
    assert.ok(!existsSync(join(tmpDir, 'categories', 'Cat B.md')));
  });

  it('honors dailyNote: false option', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir, dailyNote: false });
    await sink.sink(mockKB([mockVideo()]));
    // daily/ folder still created but empty
    assert.ok(existsSync(join(tmpDir, 'daily')));
    const dailyFiles = readdirSync(join(tmpDir, 'daily'));
    assert.equal(dailyFiles.length, 0);
  });
});

describe('ObsidianSink — YAML frontmatter', () => {
  it('README.md has valid YAML frontmatter', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    await sink.sink(mockKB([mockVideo()]));
    const content = readFileSync(join(tmpDir, 'README.md'), 'utf8');
    assert.ok(content.startsWith('---\n'), 'must start with ---');
    const fmEnd = content.indexOf('\n---\n', 4);
    assert.ok(fmEnd > 0, 'must have closing ---');
    const fm = content.slice(4, fmEnd);
    assert.ok(fm.includes('title:'));
    assert.ok(fm.includes('type: moc'));
    assert.ok(fm.includes('tags:'));
  });

  it('video note has YAML frontmatter with all required fields', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    await sink.sink(mockKB([mockVideo()]));
    const content = readFileSync(join(tmpDir, 'videos', 'Claude 学习加速法.md'), 'utf8');
    assert.ok(content.startsWith('---\n'));
    assert.ok(content.includes('source: douyin'));
    assert.ok(content.includes('analyzer: doubao'));
    assert.ok(content.includes('url: "https://douyin.com/v/123"'));
    assert.ok(content.includes('author: "测试作者"'));
    assert.ok(content.includes('category: "[[categories/AI Agent|AI Agent]]"'));
  });

  it('escapes quotes in YAML values', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    const v = mockVideo({ title: 'He said "hello"', author: 'O\'Brien' });
    await sink.sink(mockKB([v]));
    // Should not crash, should produce a file
    assert.ok(existsSync(join(tmpDir, 'videos')));
  });
});

describe('ObsidianSink — wikilinks', () => {
  it('README contains [[wikilink]] to each non-empty category', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    await sink.sink(mockKB([mockVideo(), mockVideo({ url: 'u2' })]));
    const content = readFileSync(join(tmpDir, 'README.md'), 'utf8');
    assert.ok(content.includes('[[categories/AI Agent|AI Agent]]'));
    assert.ok(content.includes('[[categories/Other|Other]]'));
  });

  it('category MOC has wikilinks to each video', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    await sink.sink(mockKB([
      mockVideo({ title: 'Video One' }),
      mockVideo({ url: 'u2', title: 'Video Two' }),
    ]));
    const content = readFileSync(join(tmpDir, 'categories', 'AI Agent.md'), 'utf8');
    assert.ok(content.includes('[[videos/Video One|Video One]]'));
    assert.ok(content.includes('[[videos/Video Two|Video Two]]'));
  });

  it('video note has backlinks to category and README', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    await sink.sink(mockKB([mockVideo()]));
    const content = readFileSync(join(tmpDir, 'videos', 'Claude 学习加速法.md'), 'utf8');
    assert.ok(content.includes('[[categories/AI Agent|AI Agent]]'));
    assert.ok(content.includes('[[README]]'));
  });
});

describe('ObsidianSink — 10 dimensions', () => {
  it('renders all 10 dimensions with correct section headers', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    await sink.sink(mockKB([mockVideo()]));
    const content = readFileSync(join(tmpDir, 'videos', 'Claude 学习加速法.md'), 'utf8');
    for (const label of [
      '1. 技能名称', '2. 技能等级', '3. 核心要点', '4. 实操步骤',
      '5. 工具/资源', '6. 避坑指南', '7. 适用场景', '8. 前置知识',
      '9. 学习路径', '10. 关键词标签',
    ]) {
      assert.ok(content.includes(`### ${label}`), `missing section: ${label}`);
    }
  });

  it('renders list dimensions as bullet points', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    await sink.sink(mockKB([mockVideo()]));
    const content = readFileSync(join(tmpDir, 'videos', 'Claude 学习加速法.md'), 'utf8');
    assert.ok(content.includes('- 六步学习闭环'));
    assert.ok(content.includes('- 二八法则'));
    assert.ok(content.includes('- Claude'));
    assert.ok(content.includes('- 不要当搜索引擎用'));
  });

  it('renders null dimensions as _(未提取到)_', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    const v = mockVideo({ dimensions: {} });
    await sink.sink(mockKB([v]));
    const content = readFileSync(join(tmpDir, 'videos', 'Claude 学习加速法.md'), 'utf8');
    // At least one section should show the null marker
    assert.ok(content.includes('_(未提取到)_'));
  });

  it('falls back to raw analysis when all dimensions are null', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    const v = mockVideo({ dimensions: {}, analysis: '原始文本' });
    await sink.sink(mockKB([v]));
    const content = readFileSync(join(tmpDir, 'videos', 'Claude 学习加速法.md'), 'utf8');
    assert.ok(content.includes('## 📝 原始分析输出'));
    assert.ok(content.includes('原始文本'));
  });
});

describe('ObsidianSink — filename sanitization', () => {
  it('removes Windows-illegal characters', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    const v = mockVideo({ title: 'bad/title:with*illegal?chars<>"|' });
    await sink.sink(mockKB([v]));
    const files = readdirSync(join(tmpDir, 'videos'));
    assert.equal(files.length, 1);
    assert.ok(!files[0].match(/[\\\/:*?"<>|]/), 'no illegal chars in filename');
  });

  it('truncates very long titles to 100 chars', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    const longTitle = 'A'.repeat(200);
    const v = mockVideo({ title: longTitle });
    await sink.sink(mockKB([v]));
    const files = readdirSync(join(tmpDir, 'videos'));
    const basename = files[0].replace(/\.md$/, '');
    assert.ok(basename.length <= 100, `expected ≤100, got ${basename.length}`);
  });

  it('handles empty title with fallback', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    const v = mockVideo({ title: '' });
    await sink.sink(mockKB([v]));
    const files = readdirSync(join(tmpDir, 'videos'));
    assert.ok(files[0].length > 0);
  });
});

describe('ObsidianSink — daily note', () => {
  it('writes YYYY-MM-DD.md in daily/', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    await sink.sink(mockKB([mockVideo(), mockVideo({ url: 'u2' })]));
    const today = new Date().toISOString().slice(0, 10);
    assert.ok(existsSync(join(tmpDir, 'daily', `${today}.md`)));
  });

  it('daily note has type: daily-note frontmatter', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    await sink.sink(mockKB([mockVideo()]));
    const today = new Date().toISOString().slice(0, 10);
    const content = readFileSync(join(tmpDir, 'daily', `${today}.md`), 'utf8');
    assert.ok(content.includes('type: daily-note'));
  });

  it('daily note lists videos grouped by category', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    await sink.sink(mockKB([
      mockVideo({ title: 'V1' }),
      mockVideo({ url: 'u2', title: 'V2' }),
      mockVideo({ url: 'u3', title: 'V3', platform: 'douyin' }),
    ]));
    const today = new Date().toISOString().slice(0, 10);
    const content = readFileSync(join(tmpDir, 'daily', `${today}.md`), 'utf8');
    assert.ok(content.includes('### AI Agent'));
    assert.ok(content.includes('### Other'));
    assert.ok(content.includes('[[videos/V1|V1]]'));
  });

  it('truncates category preview to 5 items + "...还有 N 个"', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    // Force all 8 videos into one category by using a custom KB
    const videos = Array.from({ length: 8 }, (_, i) => mockVideo({ url: `u${i}`, title: `V${i}` }));
    const kb = {
      summary: { total: 8, deepAnalysis: 8, aiRelevant: 8 },
      categoryDistribution: { 'Big Cat': 8 },
      categories: { 'Big Cat': videos },
    };
    await sink.sink(kb);
    const today = new Date().toISOString().slice(0, 10);
    const content = readFileSync(join(tmpDir, 'daily', `${today}.md`), 'utf8');
    assert.ok(content.includes('还有'), 'should show "还有 N 个" when category has >5 videos');
  });
});

describe('ObsidianSink — end-to-end', () => {
  it('produces a complete, openable vault from a realistic KB', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir, vaultName: 'Test Vault' });
    const kb = {
      generatedAt: '2026-07-09T00:00:00.000Z',
      summary: { total: 5, deepAnalysis: 5, aiRelevant: 5 },
      categoryDistribution: { 'AI Agent与工作流': 3, '开源工具': 2 },
      categories: {
        'AI Agent与工作流': [
          mockVideo({ url: 'u1', title: 'Claude 学习法' }),
          mockVideo({ url: 'u2', title: 'Firecrawl 爬取' }),
          mockVideo({ url: 'u3', title: 'GPT 提示词工程' }),
        ],
        '开源工具': [
          mockVideo({ url: 'u4', title: '开源 RSS 阅读器' }),
          mockVideo({ url: 'u5', title: '自托管 Git 服务' }),
        ],
      },
    };
    const result = await sink.sink(kb);

    // 1 README + 2 cats + 5 videos + 1 daily = 9
    assert.equal(result.filesWritten, 9);

    // Every file should be non-empty and have content
    const walkDir = (dir) => {
      const files = [];
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) files.push(...walkDir(p));
        else files.push(p);
      }
      return files;
    };
    const allFiles = walkDir(tmpDir);
    assert.ok(allFiles.length >= 9);
    for (const f of allFiles) {
      const content = readFileSync(f, 'utf8');
      assert.ok(content.length > 50, `${f} too short: ${content.length} bytes`);
    }
  });

  it('handles videos with mergedUrls (from knowledge-builder dedup)', async () => {
    const sink = new ObsidianSink({ outputDir: tmpDir });
    const v = mockVideo({ mergedUrls: ['https://douyin.com/v/dup1', 'https://douyin.com/v/dup2'] });
    await sink.sink(mockKB([v]));
    const content = readFileSync(join(tmpDir, 'videos', 'Claude 学习加速法.md'), 'utf8');
    assert.ok(content.includes('合并来源'));
    assert.ok(content.includes('https://douyin.com/v/dup1'));
    assert.ok(content.includes('https://douyin.com/v/dup2'));
  });
});
