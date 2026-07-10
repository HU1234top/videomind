/**
 * Doubao Analyzer — Use Doubao (doubao.com) as Web-SubAgent for video analysis
 *
 * MVP validated: 77/76 videos = 100% coverage (49 deep + 28 enhanced basic)
 *
 * Key innovation: Skill-focused 10-dimension framework
 * Unlike generic "summary + tags" approaches, this treats each video
 * as a learnable SKILL UNIT and outputs: what to learn → how to learn
 * → prerequisites → learning path combinations.
 */

import { getLimiter } from '../core/rate-limiter.mjs';

export class DoubaoAnalyzer {
  constructor(context) {
    this.context = context;
    this.url = 'https://doubao.com';
    this.maxRetries = 3;
    this.baseDelay = 2000;
    this.limiter = getLimiter('doubao');
  }

  /**
   * Analyze a video using Doubao's web interface
   * @param {Object} video - Video metadata (title, author, comments, transcript, tags)
   * @param {Array} attachments - Screenshots or additional data
   * @returns {Object} Structured 10-dimension skill analysis
   */
  async analyze(video, attachments = []) {
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      // Adaptive pre-request delay (learned from previous attempts)
      await this.limiter.delay();

      const t0 = Date.now();
      try {
        const result = await this._doAnalyze(video, attachments);
        this.limiter.recordSuccess(Date.now() - t0);
        return result;
      } catch (e) {
        lastError = e;
        const msg = (e.message || '').toLowerCase();

        // CAPTCHA: back off hard, give up
        if (e.code === 'CAPTCHA_DETECTED') {
          this.limiter.recordThrottle(3, 'CAPTCHA');
          throw e;
        }
        // Throttle signals
        if (msg.includes('429') || msg.includes('too many') || msg.includes('rate limit')) {
          this.limiter.recordThrottle(2, '429/rate-limit');
        } else if (msg.includes('503') || msg.includes('unavailable') || msg.includes('timeout')) {
          this.limiter.recordThrottle(1, '503/timeout');
        } else {
          this.limiter.recordError();
        }

        console.log(`[Doubao] Attempt ${attempt}/${this.maxRetries} failed: ${e.message}`);

        if (attempt < this.maxRetries) {
          const backoff = this.baseDelay * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }
    throw new Error(`Doubao analysis failed after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Single attempt at analyzing a video.
   */
  async _doAnalyze(video, attachments = []) {
    const page = await this.context.newPage();
    try {
      await page.goto(this.url);
      await page.waitForLoadState('networkidle');

      // Navigate to new conversation
      await page.click('[data-e2e="new-conversation"]').catch(() => {});
      await page.waitForTimeout(1000);

      // Construct skill-focused analysis prompt
      const prompt = this.buildPrompt(video);

      // Input prompt into Doubao's chat interface
      const inputBox = await page.locator('.chat-input, textarea, [data-e2e="chat-input"]').first();
      await inputBox.fill(prompt);
      await inputBox.press('Enter');

      // Wait for Doubao to finish generating
      await page.waitForTimeout(30000); // 30s for generation

      // Try to detect completion
      const stopBtn = page.locator('[data-e2e="stop-generating"]');
      try {
        await stopBtn.waitFor({ state: 'hidden', timeout: 60000 });
      } catch { /* generation may already be complete */ }

      // Extract the response text
      const response = await page.locator('.assistant-message, .ai-response').last().textContent();

      // Parse into structured 10-dimension format
      return this.parseResponse(video, response);
    } finally {
      await page.close();
    }
  }

  /**
   * Build a skill-focused analysis prompt
   * 
   * This prompt treats the video as a LEARNABLE SKILL UNIT,
   * not just content to summarize. It outputs actionable skill
   * dimensions that can be combined into a learning roadmap.
   */
  buildPrompt(video) {
    const videoTags = video.tags?.join(', ') || '无';
    const topComments = video.comments?.slice(0, 5).map(c =>
      typeof c === 'string' ? c : `${c.author}: ${c.text}`
    ).join('\n') || '无';

    return `你是一位技能拆解专家。请将以下视频当作一个「可学习的技能单元」来深度分析。

## 视频信息
- 标题：${video.title}
- 作者：${video.author}
- 话题标签：${videoTags}
- 精选评论：
${topComments}
- 语音转写：${video.transcript || '无'}

## 分析要求（10维度技能框架）

请按以下10个维度输出结构化分析：

1. **技能名称** — 这个视频教的具体是什么技能？用一句话命名（如"Claude 10倍速学习法"、"Firecrawl免API爬取"）
2. **技能等级** — 入门/中级/高级/专家？5级量表
3. **核心要点** — 3-5个必须记住的关键知识点
4. **实操步骤** — 可以直接照做的分步骤清单（Step 1 → Step 2 → ...）
5. **工具/资源** — 视频提到了哪些具体工具、网站、项目？
6. **避坑指南** — 作者提醒了哪些常见错误和陷阱？
7. **适用场景** — 在什么情况下需要用这个技能？
8. **前置知识** — 学这个技能之前需要先掌握什么？
9. **学习路径** — 建议跟哪些类型的视频组合学习效果更好？
10. **关键词标签** — 3-5个自动分类标签（如 #AI-Agent #爬虫 #开源工具）

每个维度请给出具体、可操作的内容，不要泛泛而谈。

## 输出格式（严格 JSON）

请**仅**以一个合法的 JSON 对象回复，不要包含任何其他文字、Markdown 代码块标记或解释。格式如下：

{"skill_name":"...","skill_level":"入门|中级|高级|专家","key_points":["...", "..."],"action_steps":["...", "..."],"tools_resources":["...", "..."],"pitfalls":["...", "..."],"use_cases":"...","prerequisites":"...","learning_path":"...","auto_tags":["#tag1", "#tag2"]}

- 字符串值用中文
- 数组值用 ["项1", "项2"] 格式
- 缺失信息填 "" 或 []
- 不要使用 markdown 代码块包裹
- 不要添加任何说明文字`;
  }

  parseResponse(video, rawText) {
    // Phase A Task 8: try JSON first (more reliable), fall back to regex
    const jsonParsed = this.tryParseJSON(rawText);
    if (jsonParsed) {
      return this.buildResultFromJSON(video, rawText, jsonParsed);
    }
    return this.buildResultFromRegex(video, rawText);
  }

  /**
   * Attempt to extract a JSON object from the response text.
   * Handles common LLM output patterns:
   *  - Raw JSON: {"foo": "bar"}
   *  - Markdown code block: ```json\n{...}\n```
   *  - Preamble text + JSON: "Here is the result:\n{...}"
   *  - Trailing explanation after JSON
   *
   * @param {string} text - Raw model output
   * @returns {Object|null} Parsed object, or null if no valid JSON found
   */
  tryParseJSON(text) {
    if (!text || typeof text !== 'string') return null;

    // 1. Try direct parse
    try {
      const direct = JSON.parse(text.trim());
      if (direct && typeof direct === 'object') return direct;
    } catch { /* fall through */ }

    // 2. Extract from markdown ```json ... ``` block
    const codeBlock = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlock) {
      try {
        const obj = JSON.parse(codeBlock[1]);
        if (obj && typeof obj === 'object') return obj;
      } catch { /* fall through */ }
    }

    // 3. Find first balanced {...} substring
    const balanced = this.extractBalancedJSON(text);
    if (balanced) {
      try {
        const obj = JSON.parse(balanced);
        if (obj && typeof obj === 'object') return obj;
      } catch { /* fall through */ }
    }

    return null;
  }

  /**
   * Find the first balanced { ... } substring (respecting nested braces and strings).
   * Used as a fallback when JSON is wrapped in prose.
   */
  extractBalancedJSON(text) {
    const start = text.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  /**
   * Build the final result object from a successfully-parsed JSON response.
   */
  buildResultFromJSON(video, rawText, parsed) {
    const dimensions = {
      skill_name: this.stringOrNull(parsed.skill_name),
      skill_level: this.stringOrNull(parsed.skill_level),
      key_points: this.arrayOrNull(parsed.key_points),
      action_steps: this.arrayOrNull(parsed.action_steps),
      tools_resources: this.arrayOrNull(parsed.tools_resources),
      pitfalls: this.arrayOrNull(parsed.pitfalls),
      use_cases: this.stringOrNull(parsed.use_cases),
      prerequisites: this.stringOrNull(parsed.prerequisites),
      learning_path: this.stringOrNull(parsed.learning_path),
      auto_tags: this.normalizeTags(parsed.auto_tags),
    };

    // Warn if too many dimensions are null (likely partial parse)
    const nullCount = Object.values(dimensions).filter(v => v === null || (Array.isArray(v) && v.length === 0)).length;
    if (nullCount >= 7) {
      console.log(`[Doubao] JSON parsed but ${nullCount}/10 dimensions empty — response may be incomplete`);
    }

    return {
      url: video.url,
      title: video.title,
      author: video.author,
      tags: video.tags || [],
      platform: 'douyin',
      analyzer: 'doubao',
      analysis: rawText,
      dimensions,
      parseMode: 'json',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Build result using the legacy regex-based extractor.
   * Used when JSON parsing fails (model didn't follow JSON instructions).
   */
  buildResultFromRegex(video, rawText) {
    const dimensions = {
      skill_name:     this.extractDimension(rawText, 1, '技能名称'),
      skill_level:    this.extractDimension(rawText, 2, '技能等级'),
      key_points:     this.extractListDimension(rawText, 3, '核心要点'),
      action_steps:   this.extractListDimension(rawText, 4, '实操步骤'),
      tools_resources: this.extractListDimension(rawText, 5, '工具[/]?资源|工具|资源'),
      pitfalls:       this.extractListDimension(rawText, 6, '避坑|陷阱|错误'),
      use_cases:      this.extractDimension(rawText, 7, '适用场景'),
      prerequisites:  this.extractDimension(rawText, 8, '前置知识|前置条件|前提'),
      learning_path:  this.extractDimension(rawText, 9, '学习路径|组合学习'),
      auto_tags:      this.extractTagsDimension(rawText, 10, '关键词标签|标签'),
    };
    return {
      url: video.url,
      title: video.title,
      author: video.author,
      tags: video.tags || [],
      platform: 'douyin',
      analyzer: 'doubao',
      analysis: rawText,
      dimensions,
      parseMode: 'regex',
      timestamp: new Date().toISOString(),
    };
  }

  stringOrNull(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  }

  arrayOrNull(v) {
    if (!Array.isArray(v)) return null;
    const cleaned = v
      .map(x => String(x).trim())
      .filter(x => x.length > 0);
    return cleaned.length > 0 ? cleaned : null;
  }

  /**
   * Normalize auto_tags: strip leading "#" if present, dedupe (case-insensitive).
   * Keeps the first-seen casing.
   */
  normalizeTags(v) {
    const arr = this.arrayOrNull(v);
    if (!arr) return null;
    const seen = new Set();
    const normalized = [];
    for (const raw of arr) {
      const t = raw.replace(/^#+/, '').trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(t);
    }
    return normalized.length > 0 ? normalized : null;
  }

  /**
   * Extract a single-value dimension from numbered section.
   * Handles formats: "1. 技能名称：XXX" or "**1. 技能名称** — XXX"
   */
  extractDimension(text, num, keyword) {
    const kwGroup = keyword.includes('|') ? `(?:${keyword})` : keyword;
    const patterns = [
      new RegExp(`(?:\\*\\*)?${num}[\\.、](?:\\*\\*)?[\\s]*${kwGroup}[：:\\s—-]+([^\\n]+)`, 'i'),
      new RegExp(`${kwGroup}[：:\\s]+([^\\n]+)`, 'i'),
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m && m[1]) return m[1].trim();
    }
    return null;
  }

  /**
   * Extract a list dimension (bullet points).
   * Handles: "- item1\n- item2" or "1）item1\n2）item2"
   */
  extractListDimension(text, num, keyword) {
    const kwGroup = keyword.includes('|') ? `(?:${keyword})` : keyword;
    // Match header "N. keyword：" (stop at colon, don't eat newlines into the section)
    const sectionPattern = new RegExp(
      `(?:\\*\\*)?${num}[\\.、](?:\\*\\*)?\\s*${kwGroup}\\s*[:：]`, ''
    );
    const sectionMatch = text.match(sectionPattern);
    if (!sectionMatch) return null;

    const startIdx = sectionMatch.index + sectionMatch[0].length;
    const nextSection = text.slice(startIdx).match(/\n\s*\d+[\.、]/);
    const endIdx = nextSection ? startIdx + nextSection.index : text.length;
    const block = text.slice(startIdx, endIdx);

    const items = [];
    // Process line-by-line to avoid greedy regex swallowing subsequent bullets
    const lines = block.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Match "- item" or "• item"
      let m = trimmed.match(/^[-•]\s+(.+)$/);
      if (m) { items.push(m[1].trim()); continue; }

      // Match "Step N: item" or "步骤N：item"
      m = trimmed.match(/^(?:Step|步骤)\s*\d+[：:]\s+(.+)$/i);
      if (m) { items.push(m[1].trim()); continue; }

      // Match "1) item" or "1） item" or "1] item"
      m = trimmed.match(/^\d+[）)\]]\s+(.+)$/);
      if (m) { items.push(m[1].trim()); continue; }
    }

    if (items.length === 0 && block.trim()) {
      return block.trim().split(/[;；\n]/).map(s => s.trim()).filter(Boolean);
    }
    return items.length > 0 ? items : null;
  }

  /**
   * Extract tags dimension.
   */
  extractTagsDimension(text, num, keyword) {
    const raw = this.extractDimension(text, num, keyword);
    if (!raw) return null;
    const hashTags = raw.match(/#([^\s#,]+)/g);
    if (hashTags && hashTags.length > 0) {
      return hashTags.map(t => t.slice(1).trim());
    }
    return raw.split(/[,，、\s]+/).map(s => s.trim()).filter(s => s.length > 1);
  }
}
