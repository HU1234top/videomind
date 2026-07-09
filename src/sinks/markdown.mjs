/**
 * Markdown Sink — Output knowledge base as local Markdown files
 * 
 * MVP validated: Complete knowledge base with 8 categories exported
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export class MarkdownSink {
  constructor(options = {}) {
    this.outputDir = options.outputDir || './output/knowledge-base';
  }

  async sink(knowledgeBase) {
    mkdirSync(this.outputDir, { recursive: true });

    // Write overview
    this.writeOverview(knowledgeBase);

    // Write each category
    for (const [category, videos] of Object.entries(knowledgeBase.categories)) {
      if (videos.length > 0) {
        this.writeCategory(category, videos);
      }
    }

    return { outputDir: this.outputDir, filesWritten: Object.keys(knowledgeBase.categories).length };
  }

  writeOverview(kb) {
    const lines = [
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
      lines.push(`| ${cat} | ${count} |`);
    }

    writeFileSync(join(this.outputDir, '总览与统计.md'), lines.join('\n'));
  }

  writeCategory(category, videos) {
    const lines = [
      `# ${category}`,
      '',
      `> 共 ${videos.length} 条视频分析`,
      '',
    ];

    for (const v of videos) {
      lines.push(`## ${v.title}`);
      lines.push(`- 作者: ${v.author}`);
      lines.push(`- 链接: ${v.url}`);
      lines.push('');
      lines.push(v.analysis || '');
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    writeFileSync(join(this.outputDir, `${category}.md`), lines.join('\n'));
  }
}
