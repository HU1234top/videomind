/**
 * Base Analyzer — Shared logic for all Web-SubAgent analyzers
 *
 * SeniorDeveloper: 重构提取公共逻辑，消除 doubao.mjs 与 kimi.mjs 之间的重复代码。
 * 原始代码来自 MiniMax M3 的 Round 4 (doubao.mjs) 和 Round 10 (kimi.mjs)，
 * 将 retry 循环、JSON 解析、10 维输出等公共部分合并到此基类。
 *
 * 用法:
 *   export class MyAnalyzer extends BaseAnalyzer {
 *     constructor(context, options = {}) {
 *       super(context, { platform: 'myplatform', ...options });
 *       this.url = 'https://example.com';
 *     }
 *     async _doAnalyze(video, attachments) { /* platform-specific UI interaction * / }
 *     buildPrompt(video) { /* prompt construction * / }
 *   }
 */

import { getLimiter } from '../core/rate-limiter.mjs';
import { createLogger } from '../core/logger.mjs';
import { loadSelectors, waitForElement, captureFailure } from '../core/selector.mjs';

export class BaseAnalyzer {
  /**
   * @param {Object} context - Playwright browser context
   * @param {Object} options
   * @param {string} options.platform - Analyzer name ('doubao'|'kimi'|'claude'|'gemini')
   * @param {Object} [options.logger] - Logger instance
   * @param {number} [options.maxRetries=3]
   * @param {number} [options.baseDelay=2000]
   */
  constructor(context, options = {}) {
    this.context = context;
    this.platform = options.platform;
    this.maxRetries = options.maxRetries || 3;
    this.baseDelay = options.baseDelay || 2000;
    this.limiter = getLimiter(this.platform);
    this.logger = options.logger || createLogger({ base: { component: 'analyzer', platform: this.platform } });
    this.url = 'https://example.com'; // subclass should set

    // Load selector config for this platform
    try {
      const config = loadSelectors(this.platform);
      this.config = config;
      this.selectors = config.selectors;
    } catch {
      this.config = null;
      this.selectors = null;
    }
  }

  /**
   * Analyze a video using the web AI platform. Subclasses should NOT override this —
   * implement _doAnalyze() instead.
   *
   * @param {Object} video - Video metadata
   * @param {Array} [attachments] - Additional data
   * @returns {Object} Structured 10-dimension analysis
   */
  async analyze(video, attachments = []) {
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      await this.limiter.delay();
      const t0 = Date.now();
      try {
        const result = await this._doAnalyze(video, attachments);
        this.limiter.recordSuccess(Date.now() - t0);
        return result;
      } catch (e) {
        lastError = e;
        const msg = (e.message || '').toLowerCase();

        if (e.code === 'CAPTCHA_DETECTED') {
          this.limiter.recordThrottle(3, 'CAPTCHA');
          throw e;
        }
        if (msg.includes('429') || msg.includes('too many') || msg.includes('rate limit')) {
          this.limiter.recordThrottle(2, '429/rate-limit');
        } else if (msg.includes('503') || msg.includes('unavailable') || msg.includes('timeout')) {
          this.limiter.recordThrottle(1, '503/timeout');
        } else {
          this.limiter.recordError();
        }

        this.logger.warn({ stage: 'analyze', platform: this.platform, attempt, maxRetries: this.maxRetries, err: e.message }, 'attempt failed');

        if (attempt < this.maxRetries) {
          const backoff = this.baseDelay * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }
    throw new Error(`${this.platform} analysis failed after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Platform-specific UI interaction. Subclasses MUST implement.
   * @abstract
   */
  async _doAnalyze(video, attachments = []) {
    throw new Error(`${this.platform} must implement _doAnalyze()`);
  }

  /**
   * Build the analysis prompt. Subclasses MUST implement.
   * @abstract
   */
  buildPrompt(video) {
    throw new Error(`${this.platform} must implement buildPrompt()`);
  }

  // ─── Response parsing ─────────────────────────────────────

  parseResponse(video, rawText) {
    const jsonParsed = this.tryParseJSON(rawText);
    if (jsonParsed) {
      return this.buildResultFromJSON(video, rawText, jsonParsed);
    }
    return this.buildResultFromRegex(video, rawText);
  }

  /** @returns {Object|null} Parsed JSON, or null if not valid */
  tryParseJSON(text) {
    if (!text || typeof text !== 'string') return null;

    try {
      const direct = JSON.parse(text.trim());
      if (direct && typeof direct === 'object') return direct;
    } catch { /* fall through */ }

    const codeBlock = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlock) {
      try {
        const obj = JSON.parse(codeBlock[1]);
        if (obj && typeof obj === 'object') return obj;
      } catch { /* fall through */ }
    }

    const balanced = this.extractBalancedJSON(text);
    if (balanced) {
      try {
        const obj = JSON.parse(balanced);
        if (obj && typeof obj === 'object') return obj;
      } catch { /* fall through */ }
    }

    return null;
  }

  /** @returns {string|null} First balanced { ... } substring */
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

  // ─── Result construction ──────────────────────────────────

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
      // M1: Round 17 — 结构化 transcript (豆包/Kimi/Claude 显式输出视频里的口语逐字)
      transcript: this.stringOrNull(parsed.transcript),
    };

    const nullCount = Object.values(dimensions).filter(v => v === null || (Array.isArray(v) && v.length === 0)).length;
    if (nullCount >= 7) {
      this.logger.warn({ platform: this.platform, nullCount }, 'JSON parsed but most dimensions empty');
    }

    return {
      url: video.url,
      title: video.title,
      author: video.author,
      tags: video.tags || [],
      platform: 'douyin',
      analyzer: this.platform,
      analysis: rawText,
      dimensions,
      parseMode: 'json',
      timestamp: new Date().toISOString(),
    };
  }

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
      // M1: transcript 字段, AI 漏 JSON 时 regex 兜底抓 'transcript|语音转写|逐字记录'
      transcript:     this.extractTranscript(rawText),
    };
    return {
      url: video.url,
      title: video.title,
      author: video.author,
      tags: video.tags || [],
      platform: 'douyin',
      analyzer: this.platform,
      analysis: rawText,
      dimensions,
      parseMode: 'regex',
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Value helpers ─────────────────────────────────────────

  stringOrNull(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  }

  arrayOrNull(v) {
    if (!Array.isArray(v)) return null;
    const cleaned = v.map(x => String(x).trim()).filter(x => x.length > 0);
    return cleaned.length > 0 ? cleaned : null;
  }

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

  // ─── M1 transcript extraction (Round 17) ─────────────────
  /**
   * Regex-based 提取 transcript 字段.
   * AI 漏 JSON 时的兜底: 抓 'transcript|语音转写|逐字记录' 后面的内容到下一个字段或段尾。
   *
   * Returns string|null. null 表示 rawText 里无 transcript 信号。
   */
  extractTranscript(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;

    // 模式 1: "transcript": "..." JSON 风格
    const jsonField = rawText.match(/["']?transcript["']?\s*[:：]\s*["']([^"'\n]{10,3000})["']/);
    if (jsonField) return jsonField[1].trim();

    // 模式 2: ## 语音转写 / 语音转写: / Transcript / 逐字记录 字面行
    // 容忍 ## markdown heading 前缀, 终止于下一个 # heading 或数字列表
    const lineMatch = rawText.match(/(?:^|\n)\s*#*\s*(?:语音转写|transcript|Transcript|逐字记录|视频脚本|原话)\s*[:：]?\s*\n+([\s\S]{20,3000}?)(?=\n\s*#+\s|\n\s*\d+\.\s|$)/i);
    if (lineMatch) return lineMatch[1].trim();

    return null;
  }

  // ─── Regex extraction helpers ──────────────────────────────

  extractDimension(text, num, keywordHint) {
    // SeniorDeveloper: 采用 MiniMax M3 (kimi.mjs) 的更鲁棒正则模式，替换原 doubao 的简单模式。
    // 支持 "1. **技能名称**: XXX"、"1. 技能名称：XXX" 等多种格式。
    const hintGroup = keywordHint.includes('|')
      ? `(?:${keywordHint})`
      : keywordHint;

    const patterns = [
      // 1. N. **hint** [:：] value (with next-section lookahead)
      new RegExp(`${num}\\.\\s*\\*\\*${hintGroup}[^*]*\\*\\*[：:]?\\s*(.+?)(?=\\n\\s*\\d+\\.\\s|$)`, 's'),
      // 2. N. hint [:：] value
      new RegExp(`${num}\\.\\s*${hintGroup}[：:]\\s*(.+?)(?=\\n\\s*\\d+\\.\\s|$)`, 's'),
      // 3. **hint** [:：] value (anywhere)
      new RegExp(`\\*\\*${hintGroup}[^*]*\\*\\*[：:]\\s*(.+?)(?=\\n|$)`, 's'),
      // 4. hint [:：] value (anywhere)
      new RegExp(`${hintGroup}[：:]\\s*(.+?)(?=\\n|$)`, 's'),
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m && m[1]) return m[1].trim();
    }
    return null;
  }

  extractListDimension(text, num, keywordHint) {
    // SeniorDeveloper: 采用 MiniMax M3 (kimi.mjs) 的更鲁棒版本
    const hintGroup = keywordHint.includes('|')
      ? `(?:${keywordHint})`
      : keywordHint;

    const headerRe = new RegExp(
      `${num}\\.\\s*(?:\\*\\*)?${hintGroup}[^*]*?(?:\\*\\*)?[：:]?\\s*`,
      's'
    );
    const headerMatch = text.match(headerRe);
    if (!headerMatch) return null;

    const start = headerMatch.index + headerMatch[0].length;
    const rest = text.slice(start);
    const nextSection = rest.match(/\n\s*\d+\.\s/);
    const end = nextSection ? nextSection.index : rest.length;
    const block = rest.slice(0, end);

    const items = [];
    const lines = block.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const stripped = trimmed.replace(/^[-*•·]\s*/, '').replace(/^\d+[\.)]\s*/, '').trim();
      if (stripped) items.push(stripped);
    }
    return items.length > 0 ? items : null;
  }

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
