/**
 * Knowledge Builder — Merge, deduplicate, categorize, and structure video analyses
 * 
 * MVP validated: 85 videos → 8 categories → structured knowledge base
 */

export class KnowledgeBuilder {
  constructor(options = {}) {
    this.categories = options.categories || DEFAULT_CATEGORIES;
  }

  /**
   * Build a structured knowledge base from raw analysis results
   */
  build(analyses) {
    // Step 1: Filter AI-relevant content
    const aiRelevant = analyses.filter(a => this.isAIRelevant(a));

    // Step 2: Auto-categorize
    const categorized = this.categorize(aiRelevant);

    // Step 3: Deduplicate (same topic covered by multiple videos)
    const deduplicated = this.deduplicate(categorized);

    // Step 4: Generate knowledge base JSON
    return {
      generatedAt: new Date().toISOString(),
      summary: {
        total: analyses.length,
        deepAnalysis: aiRelevant.length,
        aiRelevant: aiRelevant.length,
      },
      categoryDistribution: this.getDistribution(deduplicated),
      categories: deduplicated,
    };
  }

  isAIRelevant(analysis) {
    const aiKeywords = ['AI', 'agent', 'LLM', 'GPT', 'Claude', 'Gemini', '开源', '编程', 'vibecoding', '自动化'];
    const text = (analysis.analysis || '').toLowerCase();
    return aiKeywords.some(k => text.includes(k.toLowerCase()));
  }

  categorize(analyses) {
    const result = {};
    for (const cat of this.categories) {
      result[cat.name] = analyses.filter(a => this.matchesCategory(a, cat));
    }
    return result;
  }

  matchesCategory(analysis, category) {
    const text = (analysis.analysis || '').toLowerCase();
    return category.keywords.some(k => text.includes(k.toLowerCase()));
  }

  deduplicate(categorized) {
    // Simple dedup: within each category, remove videos with >80% title similarity
    const result = {};
    for (const [cat, videos] of Object.entries(categorized)) {
      result[cat] = this.removeSimilarTitles(videos);
    }
    return result;
  }

  removeSimilarTitles(videos) {
    if (videos.length <= 1) return videos;

    const SIMILARITY_THRESHOLD = 0.6;
    const kept = [];
    const mergedRefs = new Map(); // title → [urls merged into it]

    for (const video of videos) {
      const title = (video.title || '').trim();
      let bestMatch = null;
      let bestScore = 0;

      for (const existing of kept) {
        const score = this.titleSimilarity(title, existing.title);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = existing;
        }
      }

      if (bestScore >= SIMILARITY_THRESHOLD && bestMatch) {
        // Merge: keep the one with more content, add the other as reference
        const refs = mergedRefs.get(bestMatch.title) || [];
        refs.push(video.url);
        mergedRefs.set(bestMatch.title, refs);
        // If the duplicate has more analysis content, swap
        if ((video.analysis || '').length > (bestMatch.analysis || '').length) {
          const idx = kept.indexOf(bestMatch);
          kept[idx] = video;
          mergedRefs.set(video.title, refs);
        }
      } else {
        kept.push(video);
      }
    }

    // Attach merged references to kept videos
    for (const video of kept) {
      video.mergedUrls = mergedRefs.get(video.title) || [];
    }

    return kept;
  }

  /**
   * Levenshtein-based title similarity (0.0 — completely different, 1.0 — identical)
   */
  titleSimilarity(a, b) {
    if (!a || !b) return 0;
    const la = a.length, lb = b.length;
    if (la === 0) return lb === 0 ? 1 : 0;
    if (lb === 0) return 0;

    // Truncate very long titles for performance
    const maxLen = 100;
    const sa = a.slice(0, maxLen).toLowerCase();
    const sb = b.slice(0, maxLen).toLowerCase();

    const dist = this.levenshteinDist(sa, sb);
    return 1 - dist / Math.max(sa.length, sb.length);
  }

  /**
   * Standard Levenshtein distance (Wagner-Fischer algorithm)
   */
  levenshteinDist(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
    dp[0] = Array.from({ length: n + 1 }, (_, j) => j);

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,      // deletion
          dp[i][j - 1] + 1,      // insertion
          dp[i - 1][j - 1] + cost // substitution
        );
      }
    }
    return dp[m][n];
  }

  getDistribution(categorized) {
    const dist = {};
    for (const [cat, videos] of Object.entries(categorized)) {
      dist[cat] = videos.length;
    }
    return dist;
  }
}

const DEFAULT_CATEGORIES = [
  { name: 'AI Agent与工作流', keywords: ['agent', 'workflow', 'subagent', '自动化', '编排'] },
  { name: '大语言模型与推理', keywords: ['LLM', 'GPT', '推理', '语言模型', 'prompt'] },
  { name: 'AI编程工具(VibeCoding)', keywords: ['vibecoding', '编程', '代码', 'IDE', 'copilot'] },
  { name: '开源工具与项目', keywords: ['开源', 'GitHub', 'star', 'repository'] },
  { name: 'AI应用与落地', keywords: ['应用', '落地', '行业', '案例', '实践'] },
  { name: 'AI视频与多媒体', keywords: ['视频', '多媒体', '数字人', '生成', '3D'] },
  { name: 'AI设计', keywords: ['设计', 'UI', '交互', '视觉'] },
  { name: '其他', keywords: [] },
];
