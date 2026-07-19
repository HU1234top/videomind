/**
 * Markdown Sink — Output knowledge base as local Markdown files
 *
 * Enhanced: YAML frontmatter + Obsidian wikilinks + tags
 *
 * Each video section now includes:
 * - YAML frontmatter with url, author, tags, analyzed_at, analyzer
 * - [[wikilink]] cross-references to related videos in same category
 * - tags in frontmatter format for Obsidian compatibility
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export class MarkdownSink {
  constructor(options = {}) {
    this.outputDir = options.outputDir || './output/knowledge-base';
  }

  async sink(knowledgeBase) {
    mkdirSync(this.outputDir, { recursive: true });

    // Collect all video titles for wikilink generation
    const allTitles = {};
    for (const [category, videos] of Object.entries(knowledgeBase.categories)) {
      for (const v of videos) {
        if (v.title) allTitles[v.title] = category;
      }
    }

    // Write overview
    this.writeOverview(knowledgeBase);

    // Write each category
    for (const [category, videos] of Object.entries(knowledgeBase.categories)) {
      if (videos.length > 0) {
        this.writeCategory(category, videos, allTitles);
      }
    }

    return { outputDir: this.outputDir, filesWritten: Object.keys(knowledgeBase.categories).length + 1 };
  }

  writeOverview(kb) {
    const lines = [
      '---',
      `generated_at: "${new Date().toISOString()}"`,
      `total_videos: ${kb.summary.total}`,
      `deep_analysis: ${kb.summary.deepAnalysis}`,
      `ai_relevant: ${kb.summary.aiRelevant}`,
      'tags: [overview, knowledge-base]',
      '---',
      '',
      '# Skills 收藏夹 - AI技术视频知识库',
      '',
      `> 生成时间: ${new Date().toLocaleString('zh-CN')}`,
      `> 总视频数: ${kb.summary.total} | 深度分析: ${kb.summary.deepAnalysis} | AI相关: ${kb.summary.aiRelevant}`,
      '',
      '## 📊 总览',
      '',
      '| 指标 | 数值 |',
      '|------|------|',
      `| 总视频数 | ${kb.summary.total} |`,
      `| 深度分析 | ${kb.summary.deepAnalysis} |`,
      `| AI技术相关 | ${kb.summary.aiRelevant} |`,
      '',
      '### 分类分布',
      '',
      '| 分类 | 数量 |',
      '|------|:----:|',
    ];

    for (const [cat, count] of Object.entries(kb.categoryDistribution)) {
      lines.push(`| [[${cat}]] | ${count} |`);
    }

    lines.push('', '---', '', '## 📑 分类索引', '');
    for (const [cat, videos] of Object.entries(kb.categories)) {
      if (videos.length > 0) {
        lines.push(`- [[${cat}]] — ${videos.length} 条视频`);
      }
    }

    writeFileSync(join(this.outputDir, '总览与统计.md'), lines.join('\n'));
  }

  writeCategory(category, videos, allTitles) {
    const lines = [
      '---',
      `category: "${category}"`,
      `video_count: ${videos.length}`,
      `tags: [${category.replace(/[\s()]/g, '-')}]`,
      '---',
      '',
      `# ${category}`,
      '',
      `> 共 ${videos.length} 条视频分析`,
      '',
    ];

    for (const v of videos) {
      // YAML frontmatter per video section
      const tags = [
        ...(v.tags || []),
        ...(v.dimensions?.auto_tags || []),
        category.replace(/[\s()]/g, '-'),
      ].filter(Boolean);
      const uniqueTags = [...new Set(tags)];

      lines.push('---');
      lines.push(`url: "${v.url || ''}"`);
      lines.push(`author: "${v.author || ''}"`);
      lines.push(`analyzed_at: "${v.timestamp || new Date().toISOString()}"`);
      lines.push(`analyzer: "${v.analyzer || 'unknown'}"`);
      lines.push(`skill_name: "${v.dimensions?.skill_name || ''}"`);
      lines.push(`skill_level: "${v.dimensions?.skill_level || ''}"`);
      // Round 19 / L1 — consensus 元数据 (如有)
      if (v.consensus && typeof v.consensus === 'object') {
        lines.push(`consensus_mode: "${v.consensus.mode || ''}"`);
        if (typeof v.consensus.confidence === 'number') {
          lines.push(`consensus_confidence: ${v.consensus.confidence.toFixed(2)}`);
        }
        if (Array.isArray(v.consensus.analyzers)) {
          lines.push(`consensus_analyzers: [${v.consensus.analyzers.map(a => `"${a}"`).join(', ')}]`);
        }
        if (Array.isArray(v.consensus.failed)) {
          lines.push(`consensus_failed: [${v.consensus.failed.map(f => `"${f.analyzer}${f.error ? '(' + f.error.slice(0, 30) + ')' : ''}"`).join(', ')}]`);
        }
        if (Array.isArray(v.consensus.conflicts)) {
          lines.push(`consensus_conflicts: ${v.consensus.conflicts.length}`);
        }
      }
      lines.push(`tags: [${uniqueTags.map(t => `"${t}"`).join(', ')}]`);
      lines.push('---');
      lines.push('');
      lines.push(`## ${v.title}`);

      // Wikilinks to related videos in the same category
      const related = videos.filter(rv => rv.title !== v.title && rv.title);
      if (related.length > 0) {
        lines.push('> **相关视频**: ' + related.slice(0, 3).map(rv => `[[${rv.title}]]`).join(' · '));
        lines.push('');
      }

      // Merged reference URLs (from deduplication)
      if (v.mergedUrls && v.mergedUrls.length > 0) {
        lines.push(`> ⚡ 合并了 ${v.mergedUrls.length} 个相似视频：${v.mergedUrls.join(', ')}`);
        lines.push('');
      }

      lines.push(`- 作者: ${v.author || '未知'}`);
      lines.push(`- 链接: ${v.url || '（无）'}`);
      lines.push(`- 技能: ${v.dimensions?.skill_name || '(待提取)'}`);
      lines.push(`- 等级: ${v.dimensions?.skill_level || '(待提取)'}`);
      lines.push('');

      // Show structured dimensions if available
      if (v.dimensions) {
        const dims = v.dimensions;
        if (dims.key_points && dims.key_points !== null) {
          lines.push('### 核心要点');
          for (const p of dims.key_points) lines.push(`- ${p}`);
          lines.push('');
        }
        if (dims.action_steps && dims.action_steps !== null) {
          lines.push('### 实操步骤');
          for (const s of dims.action_steps) lines.push(`1. ${s}`);
          lines.push('');
        }
        if (dims.tools_resources && dims.tools_resources !== null) {
          lines.push('### 工具/资源');
          for (const t of dims.tools_resources) lines.push(`- ${t}`);
          lines.push('');
        }
        if (dims.pitfalls && dims.pitfalls !== null) {
          lines.push('### 避坑指南');
          for (const p of dims.pitfalls) lines.push(`- ${p}`);
          lines.push('');
        }
        if (dims.learning_path && dims.learning_path !== null) {
          lines.push(`### 学习路径: ${dims.learning_path}`);
          lines.push('');
        }
      }

      // Full analysis text (always included)
      lines.push('### 完整分析');
      lines.push('');
      lines.push(v.analysis || '(无分析内容)');
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    writeFileSync(join(this.outputDir, `${category}.md`), lines.join('\n'));
  }
}
