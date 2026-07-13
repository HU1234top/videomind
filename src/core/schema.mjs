/**
 * VideoMind Schema — Unified data model for video analysis results
 */

export const VideoItemSchema = {
  url: '',          // Original video URL
  title: '',       // Video title
  author: '',      // Author/creator name
  likes: 0,        // Like count
  commentsCount: 0, // Comment count
  thumb: '',       // Thumbnail URL
};

export const VideoAnalysisSchema = {
  url: '',
  title: '',
  author: '',
  // 10-dimension analysis output (validated with Doubao)
  summary: '',             // One-paragraph summary
  key_points: [],          // Core points list
  tags: [],                // Auto-generated tags
  actionable_items: [],    // Actionable takeaways
  target_audience: '',     // Target audience
  related_topics: [],      // Related topics
  difficulty_level: '',    // Difficulty rating
  core_concepts: [],       // Core concepts
  practical_examples: [],  // Practical examples
  learning_path: '',       // Learning path suggestion
};

export const KnowledgeBaseSchema = {
  generatedAt: '',         // ISO datetime
  summary: {
    total: 0,
    deepAnalysis: 0,
    aiRelevant: 0,
  },
  categoryDistribution: {}, // { "AI Agent": 35, "LLM": 16, ... }
  categories: {},           // { "AI Agent": [VideoAnalysis, ...], ... }
};

export const SUPPORTED_PLATFORMS = ['douyin', 'bilibili', 'youtube', 'xiaohongshu'];
export const SUPPORTED_ANALYZERS = ['doubao', 'kimi', 'claude'];
export const SUPPORTED_SINKS = ['lexiang', 'notion', 'obsidian', 'markdown'];
