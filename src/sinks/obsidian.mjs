/**
 * Obsidian Sink — Output knowledge base as an Obsidian-compatible vault
 *
 * Real implementation (Phase A Task 6 — closes "Obsidian ✅ 基础版" claim).
 *
 * Produces a vault structure that Obsidian can open directly:
 *
 *   vault/
 *   ├── README.md                  ← Map of Content (hub)
 *   ├── categories/
 *   │   ├── AI Agent与工作流.md    ← Per-category index
 *   │   └── ...
 *   ├── videos/
 *   │   ├── Claude 学习加速法.md   ← Per-video note
 *   │   └── ...
 *   └── daily/
 *       └── 2026-07-09.md          ← Daily note (optional)
 *
 * Key Obsidian features used:
 * - YAML frontmatter (tags, source, dates)
 * - Wikilinks [[Note Name]] for cross-references
 * - Folder-based organization (no categories table, just file tree)
 * - Dataview-friendly metadata (for users with the Dataview plugin)
 *
 * Filenames are sanitized for cross-platform safety (Windows-illegal chars removed).
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export class ObsidianSink {
  /**
   * @param {Object} options
   * @param {string} options.outputDir - Vault root (default: ./output/obsidian-vault)
   * @param {boolean} options.dailyNote - Write a daily summary note (default: true)
   * @param {string} options.vaultName  - Display name for the vault (in README header)
   */
  constructor(options = {}) {
    this.outputDir = options.outputDir || './output/obsidian-vault';
    this.dailyNote = options.dailyNote !== false;
    this.vaultName = options.vaultName || 'VideoMind Knowledge Base';
  }

  async sink(knowledgeBase) {
    const dirs = ['categories', 'videos', 'daily'];
    mkdirSync(this.outputDir, { recursive: true });
    for (const d of dirs) mkdirSync(join(this.outputDir, d), { recursive: true });

    // 1. Hub — Map of Content
    this._writeMOC(knowledgeBase);

    // 2. Per-category index pages
    let categoryCount = 0;
    for (const [category, videos] of Object.entries(knowledgeBase.categories)) {
      if (videos.length > 0) {
        this._writeCategoryMOC(category, videos);
        categoryCount++;
      }
    }

    // 3. Per-video note (one .md per video)
    const allVideos = Object.values(knowledgeBase.categories).flat();
    const videoToCategory = this._buildVideoCategoryMap(knowledgeBase);
    for (const video of allVideos) {
      const category = videoToCategory.get(this._videoKey(video)) || '其他';
      this._writeVideoNote(video, category);
    }

    // 4. Daily note (summary of this sync run)
    if (this.dailyNote) {
      this._writeDailyNote(knowledgeBase, videoToCategory);
    }

    return {
      outputDir: this.outputDir,
      filesWritten: 1 + categoryCount + allVideos.length + (this.dailyNote ? 1 : 0),
      videos: allVideos.length,
      categories: categoryCount,
    };
  }

  // ─── MOC (Map of Content) ──────────────────────────────────────────────

  _writeMOC(kb) {
    const today = new Date().toISOString().slice(0, 10);
    const tags = this._collectTags(kb);

    const lines = [
      '---',
      `title: "${this.vaultName}"`,
      `created: ${today}`,
      `type: moc`,
      `tags: [videomind, moc]`,
      '---',
      '',
      `# 🧠 ${this.vaultName}`,
      '',
      `> 生成于 ${today} · 共 ${kb.summary.total} 个视频 · 覆盖 ${Object.keys(kb.categoryDistribution).length} 个分类`,
      '',
      '## 📊 分类总览',
      '',
    ];

    // Sort categories by count desc
    const sortedCats = Object.entries(kb.categoryDistribution)
      .sort((a, b) => b[1] - a[1]);

    for (const [cat, count] of sortedCats) {
      if (count === 0) continue;
      lines.push(`- [[categories/${this._sanitizeFilename(cat)}|${cat}]] — ${count} 个视频`);
    }

    lines.push('');
    lines.push(`## 🏷️ 全部标签 (${tags.length})`);
    lines.push('');
    if (tags.length > 0) {
      lines.push(tags.map(t => `\`#${t}\``).join(' '));
    } else {
      lines.push('_(暂无标签)_');
    }

    lines.push('');
    lines.push('## 📅 最近同步');
    lines.push('');
    if (this.dailyNote) {
      const dailyName = `daily/${today}`;
      lines.push(`- [[${dailyName}|${today} 同步日志]]`);
    } else {
      lines.push(`- ${today}`);
    }
    lines.push('');

    writeFileSync(join(this.outputDir, 'README.md'), lines.join('\n'));
  }

  // ─── Per-category MOC ─────────────────────────────────────────────────

  _writeCategoryMOC(category, videos) {
    const filename = this._sanitizeFilename(category);
    const lines = [
      '---',
      `title: "${category}"`,
      `type: category-moc`,
      `category: "${category}"`,
      `tags: [videomind, category]`,
      '---',
      '',
      `# ${category}`,
      '',
      `> 共 ${videos.length} 个视频`,
      '',
      '## 视频列表',
      '',
    ];

    // Sort by date if available, otherwise alphabetical
    const sorted = [...videos].sort((a, b) => {
      const ta = a.timestamp || '';
      const tb = b.timestamp || '';
      return tb.localeCompare(ta);
    });

    for (const v of sorted) {
      const noteName = `videos/${this._sanitizeFilename(v.title || 'untitled')}`;
      const author = v.author ? ` — ${v.author}` : '';
      lines.push(`- [[${noteName}|${v.title || 'untitled'}]]${author}`);
    }

    lines.push('');
    lines.push(`← [[README|返回总览]]`);
    lines.push('');

    writeFileSync(join(this.outputDir, 'categories', `${filename}.md`), lines.join('\n'));
  }

  // ─── Per-video note ────────────────────────────────────────────────────

  _writeVideoNote(video, category) {
    const filename = this._sanitizeFilename(video.title || 'untitled');
    const today = new Date().toISOString().slice(0, 10);
    const dims = video.dimensions || {};
    const tags = this._extractVideoTags(video);

    const lines = [
      '---',
      `title: "${this._escapeYaml(video.title || 'untitled')}"`,
      `source: ${video.platform || 'unknown'}`,
      `url: "${this._escapeYaml(video.url || '')}"`,
      `author: "${this._escapeYaml(video.author || '')}"`,
      `analyzer: ${video.analyzer || 'unknown'}`,
      `analyzed_at: "${video.timestamp || today}"`,
      `category: "[[categories/${this._sanitizeFilename(category)}|${category}]]"`,
      `tags: [videomind, ${tags.map(t => this._escapeYaml(t)).join(', ')}]`,
      '---',
      '',
      `# ${video.title || 'untitled'}`,
      '',
      `> 来源: [[categories/${this._sanitizeFilename(category)}|${category}]] · 作者: ${video.author || '未知'}`,
      '',
      '## 📋 元数据',
      '',
      '| 字段 | 值 |',
      '|------|------|',
      `| 链接 | ${video.url || '_(无)_'} |`,
      `| 作者 | ${video.author || '_(无)_'} |`,
      `| 分析器 | ${video.analyzer || '_(无)_'} |`,
      `| 分析时间 | ${video.timestamp || '_(无)_'} |`,
      `| 原平台 | ${video.platform || '_(无)_'} |`,
      '',
    ];

    // 10-dimension structured output
    lines.push('## 🎯 10 维度分析');
    lines.push('');

    const dimMap = [
      ['1. 技能名称', dims.skill_name],
      ['2. 技能等级', dims.skill_level],
      ['3. 核心要点', dims.key_points],
      ['4. 实操步骤', dims.action_steps],
      ['5. 工具/资源', dims.tools_resources],
      ['6. 避坑指南', dims.pitfalls],
      ['7. 适用场景', dims.use_cases],
      ['8. 前置知识', dims.prerequisites],
      ['9. 学习路径', dims.learning_path],
      ['10. 关键词标签', dims.auto_tags],
    ];

    for (const [label, value] of dimMap) {
      lines.push(`### ${label}`);
      if (value === null || value === undefined) {
        lines.push('_(未提取到)_');
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          lines.push('_(空)_');
        } else {
          for (const item of value) {
            lines.push(`- ${item}`);
          }
        }
      } else {
        lines.push(String(value));
      }
      lines.push('');
    }

    // Fallback: raw analysis if dimensions were all null
    if (!dims.skill_name && video.analysis) {
      lines.push('---');
      lines.push('');
      lines.push('## 📝 原始分析输出');
      lines.push('');
      lines.push(video.analysis);
      lines.push('');
    }

    // Backlinks
    lines.push('---');
    lines.push('');
    lines.push('## 🔗 关联');
    lines.push('');
    lines.push(`- 分类: [[categories/${this._sanitizeFilename(category)}|${category}]]`);
    lines.push(`- 总览: [[README]]`);
    if (video.mergedUrls && video.mergedUrls.length > 0) {
      lines.push(`- 合并来源:`);
      for (const url of video.mergedUrls) {
        lines.push(`  - ${url}`);
      }
    }
    lines.push('');

    writeFileSync(join(this.outputDir, 'videos', `${filename}.md`), lines.join('\n'));
  }

  // ─── Daily note ────────────────────────────────────────────────────────

  _writeDailyNote(kb, videoToCategory) {
    const today = new Date().toISOString().slice(0, 10);
    const allVideos = Object.values(kb.categories).flat();

    const lines = [
      '---',
      `title: "${today}"`,
      `type: daily-note`,
      `tags: [videomind, daily]`,
      '---',
      '',
      `# 📅 ${today} — VideoMind 同步日志`,
      '',
      `> 本次同步新增/更新 ${allVideos.length} 个视频`,
      '',
      '## 📊 本次汇总',
      '',
      '| 指标 | 数值 |',
      '|------|------|',
      `| 视频总数 | ${kb.summary.total} |`,
      `| AI 相关 | ${kb.summary.aiRelevant} |`,
      `| 分类数 | ${Object.keys(kb.categoryDistribution).length} |`,
      '',
      '## 🆕 本次新增',
      '',
    ];

    // Group by category
    for (const [cat, videos] of Object.entries(kb.categories)) {
      if (videos.length === 0) continue;
      lines.push(`### ${cat} (${videos.length})`);
      for (const v of videos.slice(0, 5)) {
        const noteName = `videos/${this._sanitizeFilename(v.title || 'untitled')}`;
        lines.push(`- [[${noteName}|${v.title || 'untitled'}]]`);
      }
      if (videos.length > 5) {
        lines.push(`- _...还有 ${videos.length - 5} 个，查看 [[categories/${this._sanitizeFilename(cat)}|${cat}]]_`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('← [[README|返回总览]]');
    lines.push('');

    writeFileSync(join(this.outputDir, 'daily', `${today}.md`), lines.join('\n'));
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  _buildVideoCategoryMap(kb) {
    const map = new Map();
    for (const [cat, videos] of Object.entries(kb.categories)) {
      for (const v of videos) {
        map.set(this._videoKey(v), cat);
      }
    }
    return map;
  }

  _videoKey(video) {
    return video.url || video.title || JSON.stringify(video).slice(0, 200);
  }

  _collectTags(kb) {
    const tags = new Set();
    for (const videos of Object.values(kb.categories)) {
      for (const v of videos) {
        for (const t of this._extractVideoTags(v)) tags.add(t);
      }
    }
    return [...tags].sort();
  }

  _extractVideoTags(video) {
    const tags = [];
    // From auto_tags dimension (preferred)
    if (video.dimensions?.auto_tags) {
      for (const t of video.dimensions.auto_tags) tags.push(String(t));
    }
    // From video.tags (Douyin topic tags)
    if (Array.isArray(video.tags)) {
      for (const t of video.tags) tags.push(String(t));
    }
    return tags;
  }

  /**
   * Sanitize a string for use as a filename on Windows + macOS + Linux.
   * Removes: \ / : * ? " < > | and control chars
   * Truncates to 100 chars (Obsidian performance degrades with very long names).
   */
  _sanitizeFilename(name) {
    if (!name) return 'untitled';
    return String(name)
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'untitled';
  }

  /**
   * Escape a string for safe inclusion in a YAML double-quoted value.
   */
  _escapeYaml(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
}
