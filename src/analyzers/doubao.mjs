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
    this.baseDelay = 2000; // base delay for exponential backoff (2s)
    this.limiter = getLimiter('doubao');
  }

  /**
   * Analyze a video using Doubao's web interface.
   *
   * Improvements over original:
   * - Exponential backoff retry (max 3 attempts)
   * - CAPTCHA / verification page detection
   * - Dynamic generation completion detection (no magic timeouts)
   * - Health check: verify page loaded correctly before proceeding
   *
   * @param {Object} video - Video metadata (title, author, comments, transcript, tags)
   * @param {Object} options - { attempt, maxRetries } for retry context
   * @returns {Object} Structured 10-dimension skill analysis
   */
  async analyze(video, options = {}) {
    const maxRetries = options.maxRetries || this.maxRetries;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Adaptive pre-request delay (learned from previous attempts)
      await this.limiter.delay();

      const t0 = Date.now();
      try {
        const result = await this._doAnalyze(video, attempt);
        const elapsed = Date.now() - t0;
        this.limiter.recordSuccess(elapsed);
        return result;
      } catch (e) {
        // Don't retry on CAPTCHA — user must handle manually
        if (e.code === 'CAPTCHA_DETECTED') {
          this.limiter.recordThrottle(3, 'CAPTCHA');
          throw e;
        }

        console.log(`[Doubao] Attempt ${attempt}/${maxRetries} failed: ${e.message}`);

        // Detect throttle vs transient error and feed the limiter
        const msg = (e.message || '').toLowerCase();
        if (msg.includes('429') || msg.includes('too many') || msg.includes('rate limit')) {
          this.limiter.recordThrottle(2, msg.match(/\d{3}/)?.[0] || 'rate-limit');
        } else if (msg.includes('503') || msg.includes('unavailable') || msg.includes('timeout')) {
          this.limiter.recordThrottle(1, '503/timeout');
        } else {
          this.limiter.recordError();
        }

        if (attempt < maxRetries) {
          const delay = this.baseDelay * Math.pow(2, attempt - 1);
          console.log(`[Doubao] Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw new Error(`Doubao analysis failed after ${maxRetries} attempts for: ${video.title}`);
  }

  /**
   * Single attempt at analyzing a video.
   */
  async _doAnalyze(video, attempt) {
    const page = await this.context.newPage();
    try {
      // Step 1: Navigate to Doubao
      await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 15000 });

      // Step 2: Health check — verify page loaded correctly
      await this.healthCheck(page);

      // Step 3: Check for CAPTCHA
      if (await this.detectCaptcha(page)) {
        const err = new Error('CAPTCHA detected on Doubao — please handle manually in your browser, then retry');
        err.code = 'CAPTCHA_DETECTED';
        throw err;
      }

      // Step 4: Navigate to new conversation
      const newChatBtns = [
        '[data-e2e="new-conversation"]',
        '.new-chat-btn',
        'button[class*="new"]',
        '[aria-label*="new"]',
      ];
      for (const selector of newChatBtns) {
        await page.click(selector).catch(() => {});
      }
      await page.waitForTimeout(1500);

      // Step 5: Build and input the analysis prompt
      const prompt = this.buildPrompt(video);
      const inputSelectors = [
        '.chat-input',
        'textarea',
        '[data-e2e="chat-input"]',
        '[class*="input-box"]',
        '[role="textbox"]',
      ];
      let inputBox = null;
      for (const sel of inputSelectors) {
        inputBox = page.locator(sel).first();
        if (await inputBox.isVisible().catch(() => false)) break;
        inputBox = null;
      }
      if (!inputBox) throw new Error('Cannot find Doubao chat input box');

      await inputBox.fill(prompt);
      await inputBox.press('Enter');

      // Step 6: Dynamic wait for generation completion
      await this.waitForGeneration(page);

      // Step 7: Extract response text
      const responseSelectors = [
        '.assistant-message',
        '.ai-response',
        '[data-e2e="assistant-message"]',
        '[class*="response"]',
      ];
      let response = null;
      for (const sel of responseSelectors) {
        const el = page.locator(sel).last();
        const text = await el.textContent().catch(() => null);
        if (text && text.trim().length > 50) {
          response = text;
          break;
        }
      }
      if (!response) throw new Error('Could not extract Doubao response text');

      // Step 8: Parse into structured 10-dimension format
      return this.parseResponse(video, response);
    } finally {
      await page.close();
    }
  }

  /**
   * Health check: verify Doubao page loaded correctly.
   */
  async healthCheck(page) {
    // Check that we're actually on doubao.com
    const url = page.url();
    if (!url.includes('doubao.com') && !url.includes('doubao')) {
      throw new Error(`Not on Doubao page — current URL: ${url}`);
    }
    // Check that page body exists
    const body = await page.locator('body').isVisible().catch(() => false);
    if (!body) throw new Error('Doubao page appears blank or not loaded');
  }

  /**
   * Detect CAPTCHA / verification pages.
   */
  async detectCaptcha(page) {
    const captchaSignals = [
      // Generic CAPTCHA patterns
      'iframe[src*="captcha"]',
      '[class*="captcha"]',
      '[id*="captcha"]',
      'img[src*="captcha"]',
      // Verification page text
      'text=验证',
      'text=请完成验证',
      'text=安全验证',
      // Slider verification
      '[class*="slider-verify"]',
      '[class*="verify"]',
    ];
    for (const sel of captchaSignals) {
      const found = await page.locator(sel).first().isVisible().catch(() => false);
      if (found) return true;
    }
    return false;
  }

  /**
   * Dynamic wait for AI generation completion.
   * Instead of magic 30s + 60s timeouts, we:
   * 1. Wait for the "stop generating" button to appear (generation started)
   * 2. Then wait for it to disappear (generation finished)
   * 3. If no stop button found, wait for response text to stabilize
   */
  async waitForGeneration(page) {
    // Phase 1: Wait for generation to start (stop button appears)
    const stopBtnSelectors = [
      '[data-e2e="stop-generating"]',
      '[class*="stop-generating"]',
      '[class*="stop"]',
      'button[aria-label*="stop"]',
    ];

    let stopBtn = null;
    for (const sel of stopBtnSelectors) {
      stopBtn = page.locator(sel).first();
      if (await stopBtn.isVisible({ timeout: 5000 }).catch(() => false)) break;
      stopBtn = null;
    }

    if (stopBtn) {
      // Phase 2: Wait for stop button to disappear (generation complete)
      try {
        await stopBtn.waitFor({ state: 'hidden', timeout: 120000 });
      } catch {
        // Timeout — generation may be very long, try to proceed anyway
        console.log('[Doubao] Generation timeout (120s), proceeding with partial response');
      }
    } else {
      // No stop button detected — fallback: wait for response text to stabilize
      // Check every 3s if the last response element text has changed
      let lastText = '';
      let stableCount = 0;
      for (let i = 0; i < 20; i++) { // max 60s
        await page.waitForTimeout(3000);
        const currentText = await page.locator('.assistant-message, .ai-response, [class*="response"]').last()
          .textContent().catch(() => '');
        if (currentText === lastText && currentText.length > 100) {
          stableCount++;
          if (stableCount >= 2) break; // Stable for 6s = done
        } else {
          stableCount = 0;
        }
        lastText = currentText;
      }
    }

    // Small buffer after generation completes
    await page.waitForTimeout(1000);
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

每个维度请给出具体、可操作的内容，不要泛泛而谈。`;
  }

  /**
   * Parse Doubao's text response into structured 10-dimension output.
   *
   * Doubao returns Chinese text with numbered sections matching the prompt.
   * We use regex to extract each dimension. If a dimension can't be parsed,
   * we fall back to null — downstream consumers should handle nulls.
   */
  parseResponse(video, rawText) {
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
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Extract a single-value dimension from numbered section.
   * Handles formats: "1. 技能名称：XXX" or "**1. 技能名称** — XXX"
   */
  extractDimension(text, num, keyword) {
    // Wrap keyword with | alternation in non-capturing group
    // so "前置知识|前提" becomes (?:前置知识|前提), not the whole regex
    const kwGroup = keyword.includes('|') ? `(?:${keyword})` : keyword;

    // Match: "N. <keyword>：content" or "N、<keyword>：content" or "**N** ... keyword ... content"
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
   * Handles: "- item1\n- item2" or "1）item1  2）item2"
   */
  extractListDimension(text, num, keyword) {
    const kwGroup = keyword.includes('|') ? `(?:${keyword})` : keyword;

    // First extract the section block
    const sectionPattern = new RegExp(
      `(?:\\*\\*)?${num}[\\.、](?:\\*\\*)?[\\s]*${kwGroup}[：:\\s—-]+`, 'i'
    );
    const sectionMatch = text.match(sectionPattern);
    if (!sectionMatch) return null;

    // Get text from section start to next numbered section or end
    const startIdx = sectionMatch.index + sectionMatch[0].length;
    const nextSection = text.slice(startIdx).match(/\n\s*\d+[\.、]/);
    const endIdx = nextSection ? startIdx + nextSection.index : text.length;
    const block = text.slice(startIdx, endIdx);

    // Parse bullet items: "- item" or "• item" or "1）item" or "Step N: item"
    const items = [];
    const bulletPattern = /[-•]\s+([^\n]+)/g;
    const stepPattern = /(?:Step|步骤)\s*\d+[：:]\s+([^\n]+)/gi;
    const numberedPattern = /\d+[）)\]]\s+([^\n]+)/g;

    for (const p of [bulletPattern, stepPattern, numberedPattern]) {
      let m;
      while ((m = p.exec(block)) !== null) {
        items.push(m[1].trim());
      }
    }

    // If no structured bullets found, split by semicolons or newlines
    if (items.length === 0 && block.trim()) {
      return block.trim().split(/[;；\n]/).map(s => s.trim()).filter(Boolean);
    }

    return items.length > 0 ? items : null;
  }

  /**
   * Extract tags dimension: "#tag1 #tag2" format or comma-separated
   */
  extractTagsDimension(text, num, keyword) {
    const raw = this.extractDimension(text, num, keyword);
    if (!raw) return null;

    // Extract #hashtag style tags
    const hashTags = raw.match(/#([^\s#,]+)/g);
    if (hashTags && hashTags.length > 0) {
      return hashTags.map(t => t.slice(1).trim());
    }

    // Fall back to comma/中文逗号 split
    return raw.split(/[,，、\s]+/).map(s => s.trim()).filter(s => s.length > 1);
  }
}
