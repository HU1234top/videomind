/**
 * Kimi Analyzer — Use Kimi (kimi.com) as Web-SubAgent for video analysis
 *
 * Round 10 (Phase B Task 2): Kimi Analyzer 真实实现
 *
 * 借鉴 doubao.mjs 的所有模式：
 *   - 重试循环 + CAPTCHA 早退 + 指数退避
 *   - loadSelectors('kimi') + 智能等待 (dom-watcher)
 *   - JSON/regex 双解析（tryParseJSON + extractBalancedJSON + buildResultFromJSON + buildResultFromRegex）
 *   - 10 维度技能框架 (skill_name/skill_level/key_points/...)
 *
 * Kimi vs Doubao 关键差异：
 *   - URL: https://www.kimi.com/ (kimi.ai 自动跳转)
 *   - chat input 是 contenteditable div，**不能用 .fill() 直接填**
 *   - 发送按钮在 chat-editor-action 容器内，输入文本后才激活
 *   - Kimi 网页版**无需登录**即可 chat
 *
 * 实现策略：contenteditable 用 page.evaluate 设 innerHTML + 触发 input 事件
 *           （Lexical editor 监听 input 事件更新内部 state）
 */

import { getLimiter } from '../core/rate-limiter.mjs';
import { createLogger } from '../core/logger.mjs';
import { loadSelectors, waitForElement, captureFailure } from '../core/selector.mjs';
import { waitForBodyTextStable, waitForElementTextStable } from '../core/dom-watcher.mjs';

export class KimiAnalyzer {
  constructor(context, options = {}) {
    this.context = context;
    this.url = 'https://www.kimi.com/';
    this.maxRetries = 3;
    this.baseDelay = 2000;
    this.limiter = getLimiter('kimi');
    this.logger = options.logger || createLogger({ base: { component: 'analyzer', platform: 'kimi' } });
    const config = loadSelectors('kimi');
    this.config = config;
    this.selectors = config.selectors;
  }

  /**
   * Analyze a video using Kimi's web interface
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

        this.logger.warn({ stage: 'analyze', platform: 'kimi', attempt, maxRetries: this.maxRetries, err: e.message }, 'attempt failed');

        if (attempt < this.maxRetries) {
          const backoff = this.baseDelay * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }
    throw new Error(`Kimi analysis failed after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Single attempt at analyzing a video.
   *
   * Round 10 Kimi 适配点：
   *   - chat input 是 contenteditable div → 用 page.evaluate 设 innerHTML + dispatchEvent('input')
   *   - 发送按钮在 chat-editor-action 容器内 → 等按钮出现（输入后才激活）
   *   - 智能等待用 waitForElementTextStable + body innerText 双重 fallback
   */
  async _doAnalyze(video, attachments = []) {
    const page = await this.context.newPage();
    const log = this.logger;
    try {
      await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      // Round 10 关键步骤: 关闭登录弹窗 (Kimi 在用户尝试 chat 时弹强制登录)
      await this._dismissLoginModal(page);

      // 等输入框出现
      const inputResult = await waitForElement(page, this.selectors.chatInput, {
        intervals: [3000, 5000],
        scrollTrigger: false,
        logger: log
      });
      if (!inputResult.element) {
        log?.error?.({ attempts: inputResult.attempts }, 'chat input not found');
        await captureFailure(page, 'no-chat-input', { logger: log });
        throw new Error('chat input not found — selectors/kimi.json may be outdated');
      }

      // 构造 prompt + 输入（contenteditable div 特殊处理）
      const prompt = this.buildPrompt(video);
      await this._fillContentEditable(page, inputResult.element, prompt);
      await new Promise(r => setTimeout(r, 1000));  // 等 Lexical editor 处理 input 事件

      // 尝试找发送按钮（输入后才激活），fallback 按 Enter
      const sendResult = await waitForElement(page, this.selectors.sendButton, {
        intervals: [1500, 2000, 3000],  // 多给点时间让按钮从 disabled 激活
        scrollTrigger: false,
        logger: log
      });
      if (sendResult.element) {
        log?.debug?.({ selector: sendResult.selector }, 'clicking send button');
        await sendResult.element.click();
      } else {
        log?.warn?.({ prompt: prompt.slice(0, 50) }, 'no send button, pressing Enter');
        // Enter 在 Lexical editor 上通常触发发送
        await page.keyboard.press('Enter');
      }

      // 智能等待: AI 回复元素文本连续 3 次 (24s) 稳定
      const responseSelector = this.selectors.responseContainer.primary;
      log?.debug?.({ selector: responseSelector }, 'waiting for AI response to stabilize');
      const t0 = Date.now();
      let responseText;
      try {
        const stable = await waitForElementTextStable(page, responseSelector, {
          pollIntervalMs: 8000,
          stableCount: 3,
          maxWaitMs: 600000,  // 10 分钟
          tailLength: 500
        });
        responseText = stable.text;
      } catch (e) {
        // Fallback: 用 body innerText 末尾 (WorkBuddy batch_doubao_v5.mjs 同款)
        log?.warn?.({ err: e.message }, 'element-stable failed, falling back to body innerText tail');
        const bodyText = await waitForBodyTextStable(page, {
          pollIntervalMs: 8000,
          stableCount: 3,
          maxWaitMs: 600000
        });
        responseText = bodyText;
      }
      log?.info?.({ took: Date.now() - t0, len: responseText.length }, 'AI response captured');

      return this.parseResponse(video, responseText);
    } catch (e) {
      log?.error?.({ err: e.message, video: video.url }, '_doAnalyze failed');
      await captureFailure(page, 'analyze-failed', { logger: log });
      throw e;
    } finally {
      await page.close();
    }
  }

  /**
   * Kimi 在用户尝试 chat 时会弹出强制登录弹窗（即使是首页看似无需登录）。
   * 弹窗出现时机: 首次访问 / 长时间未活动 / IP 切换。
   *
   * 关闭策略:
   *   1. 找关闭按钮 (class*=close / [aria-label*=关闭])
   *   2. 找不到 → 按 ESC
   *   3. 弹窗仍在 → 抛 NotLoggedInError 让 Router skip（用户登录后再用）
   */
  async _dismissLoginModal(page) {
    const before = await page.evaluate(() => ({
      hasModal: !!document.querySelector('.wechat-login-qrcode, [class*="login-modal" i], [class*="modal"]')
    }));
    this.logger.debug({ stage: 'kimi', before }, 'checking login modal');

    // 1. 找关闭按钮
    const closeBtn = await page.$(
      'button[class*="close" i], [class*="modal"] [class*="close" i], [aria-label*="关闭" i], [aria-label*="Close" i], [aria-label*="close" i]'
    );
    if (closeBtn) {
      await closeBtn.click({ timeout: 2000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 500));
    } else {
      // 2. 按 ESC 兜底
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 500));
    }

    const after = await page.evaluate(() => ({
      hasModal: !!document.querySelector('.wechat-login-qrcode, [class*="login-modal" i], [class*="modal"]')
    }));
    if (after.hasModal) {
      const { NotLoggedInError } = await import('../core/analyzer-errors.mjs');
      throw new NotLoggedInError('kimi', 'Kimi requires login (modal still visible after dismiss)');
    }
    if (before.hasModal) {
      this.logger.info({ stage: 'kimi' }, 'login modal dismissed');
    }
  }

  /**
   * Fill a contenteditable div with text (Kimi uses Lexical editor).
   *
   * 关键约束（来自 E2E 验证）:
   *   1. Lexical 不响应 innerHTML 或 dispatchEvent('input')，必须用 keyboard.type
   *   2. **绝不能按 Enter** —— Lexical 把 Enter 当发送，会自动提交没输完的内容
   *   3. 输入框有字数限制（~2000 字符），超过会被截断或自动发送
   *   4. prompt 里的换行必须替换成空格（Lexical 把 Enter 当 commit）
   *
   * 流程:
   *   1. click focus + Ctrl+A 全选 + Delete 清空
   *   2. 截断文本到 ~1800 字符（留 200 缓冲应对计数器差异）
   *   3. 用空格 join 多行（避免 Enter 触发发送）
   *   4. keyboard.type 一次性输入（不加 Enter）
   *   5. 验证 input 真的有内容
   */
  async _fillContentEditable(page, element, text) {
    const log = this.logger;
    // Round 10 E2E fix: 不依赖外部传入的 element handle（可能 stale），
    // 每次都重新 locator + verify visible
    const editableLocator = page.locator('div.chat-input-editor[contenteditable="true"]').first();
    await editableLocator.waitFor({ state: 'visible', timeout: 5000 });
    await editableLocator.click();
    await new Promise(r => setTimeout(r, 500));

    // 全选并清空（键盘路径）
    await page.keyboard.press('Control+A');
    await new Promise(r => setTimeout(r, 150));
    await page.keyboard.press('Delete');
    await new Promise(r => setTimeout(r, 300));

    // 验证清空成功
    const emptyBefore = await page.evaluate(() => {
      const e = document.querySelector('div.chat-input-editor[contenteditable="true"]');
      if (!e) return { found: false };
      return { found: true, len: (e.textContent || '').length, focused: document.activeElement === e };
    });
    log?.debug?.({ stage: 'kimi', emptyBefore }, 'pre-fill state');

    if (!emptyBefore.found) {
      throw new Error('contenteditable input not found on page');
    }
    if (emptyBefore.len > 0) {
      log?.warn?.({ stage: 'kimi', msg: 'input not empty after Ctrl+A+Delete, force clearing' });
      await page.evaluate(() => {
        const e = document.querySelector('div.chat-input-editor[contenteditable="true"]');
        if (e) e.innerHTML = '';
      });
      await new Promise(r => setTimeout(r, 200));
    }

    // 截断到 ~1800 字符（Kimi 输入框硬限制约 2000）
    const MAX_CHARS = 1800;
    let safeText = text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')   // 连续 3+ 换行 → 2 换行
      .replace(/\n/g, ' ')          // prompt 里换行 → 空格 (Lexical 把 Enter 当发送)
      .trim();
    if (safeText.length > MAX_CHARS) {
      log?.warn?.({ stage: 'kimi', original: text.length, truncated: MAX_CHARS }, 'prompt truncated to fit input limit');
      safeText = safeText.slice(0, MAX_CHARS) + ' ...(已截断)';
    }

    // 用 keyboard.type 一次性输入（不加 Enter）
    await page.keyboard.type(safeText, { delay: 1 });

    await new Promise(r => setTimeout(r, 500));

    // 验证 input 真的有内容（且没被自动发送 = input 仍存在）
    const stateAfter = await page.evaluate(() => {
      const e = document.querySelector('div.chat-input-editor[contenteditable="true"]');
      if (!e) return { found: false, len: 0 };
      return { found: true, len: (e.textContent || '').length, preview: (e.textContent || '').slice(0, 80) };
    });
    log?.debug?.({ stage: 'kimi', inputLen: stateAfter.len, expected: safeText.length, preview: stateAfter.preview }, 'contenteditable fill result');

    if (!stateAfter.found) {
      throw new Error('contenteditable input not found after typing — page may have navigated');
    }
    if (stateAfter.len === 0) {
      throw new Error('contenteditable input still empty after typing — keyboard.type did not work');
    }
    // 允许少量字符差异（HTML 实体编码等），但不应差太多
    if (stateAfter.len < safeText.length * 0.5) {
      log?.warn?.({ stage: 'kimi', got: stateAfter.len, expected: safeText.length }, 'input content much shorter than expected — may be truncated by UI');
    }
  }

  /**
   * Build a skill-focused analysis prompt
   *
   * 与 doubao.mjs 相同的 10 维度框架 — 中文本地 LLM 对此理解一致
   */
  /**
   * Round 10 终极简化：从"元数据堆叠 + JSON 结构化"改为"传链接 + 一句话"。
   *
   * 用户原话: 「付附带的 prompt 提示词是，帮我详细分析这个视频，这么简约点不行吗？」
   *
   * Kimi 这种通用 Web AI 不需要严格 JSON 指令——它会读视频 + 返回自然语言分析。
   * Round 8 doubao 的 10 维度 JSON 是豆包专用 prompt，跟 Kimi 不同。
   *
   * 实际发的是:
   *   <video_url>
   *   帮我详细分析这个视频
   */
  buildPrompt(video) {
    return `${video.url}\n帮我详细分析这个视频`;
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
   * Handles common LLM output patterns (复用 doubao 逻辑):
   *  - Raw JSON: {"foo": "bar"}
   *  - Markdown code block: ```json\n{...}\n```
   *  - Preamble text + JSON: "Here is the result:\n{...}"
   *  - Trailing explanation after JSON
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
      this.logger.warn({ stage: 'analyze', platform: 'kimi', nullCount, total: 10 }, 'JSON parsed but dimensions incomplete');
    }

    return {
      url: video.url,
      title: video.title,
      author: video.author,
      tags: video.tags || [],
      platform: 'douyin',
      analyzer: 'kimi',
      analysis: rawText,
      dimensions,
      parseMode: 'json',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Build result using the legacy regex-based extractor.
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
      analyzer: 'kimi',
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
    const out = [];
    for (const tag of arr) {
      const t = tag.startsWith('#') ? tag.slice(1) : tag;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push('#' + t);
    }
    return out.length > 0 ? out : null;
  }

  /**
   * Extract a single-line dimension by number and optional Chinese keyword hint.
   * Strategy: find "N. **关键词** — value" or "N. 关键词: value" pattern.
   * Tolerates **wrapper** around hint, optional : / ： separator.
   */
  extractDimension(text, num, keywordHint) {
    // Build a regex group from hint alternatives: '避坑|陷阱|错误' → '(?:避坑|陷阱|错误)'
    const hintGroup = keywordHint.includes('|')
      ? `(?:${keywordHint})`
      : keywordHint;

    // Try patterns in order of specificity.
    const patterns = [
      // 1. N. **hint** [:：] value
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

  /**
   * Extract a list dimension (array of strings).
   * Looks for numbered lines or bullet points until the next numbered section.
   * Tolerates **wrapper** around hint + | alternatives like '避坑|陷阱|错误'.
   */
  extractListDimension(text, num, keywordHint) {
    // Build a regex group from hint alternatives: '避坑|陷阱|错误' → '(?:避坑|陷阱|错误)'
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
    // Cut at next "N." where N is digit
    const nextSection = rest.match(/\n\s*\d+\.\s/);
    const end = nextSection ? nextSection.index : rest.length;
    const block = rest.slice(0, end);

    const items = [];
    const lines = block.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Strip leading "- " or "* " or "1) " or numbered prefix
      const stripped = trimmed.replace(/^[-*•·]\s*/, '').replace(/^\d+[\.)]\s*/, '').trim();
      if (stripped) items.push(stripped);
    }
    return items.length > 0 ? items : null;
  }

  /**
   * Extract tags dimension. Tags are usually "#tag1 #tag2 ..." on one line.
   */
  extractTagsDimension(text, num, keywordHint) {
    const dim = this.extractDimension(text, num, keywordHint);
    if (!dim) return null;
    const tags = [];
    const seen = new Set();
    for (const part of dim.split(/[\s,]+/)) {
      const t = part.trim();
      if (!t) continue;
      const clean = t.startsWith('#') ? t.slice(1) : t;
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push('#' + clean);
    }
    return tags.length > 0 ? tags : null;
  }
}