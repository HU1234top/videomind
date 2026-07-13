/**
 * Claude Analyzer — Use Claude.ai Web Chat as Web-SubAgent for video analysis
 *
 * Round 16 (Phase B Task 3): Claude.ai 真实实现
 *
 * Claude vs Kimi/Doubao 关键差异:
 *   - URL: https://claude.ai/chat (自动跳 /chat)
 *   - chat input 是 ProseMirror contenteditable div
 *   - 发送按钮是 button[aria-label='Send message' i] (回车也能发)
 *   - **必须登录** — claude.ai 会 redirect /login, Router 捕 NotLoggedInError
 *
 * 实现策略: 完全沿用 BaseAnalyzer + Kimi 模式 (lexical/prosemirror contenteditable)
 *           公共部分由基类负责 (retry / limiter / logger / JSON parse / 10 维度)
 *           平台特有部分 (UI 交互) 在这里实现。
 *
 * 待验证:
 *   - selector 是基于公开文档 + 经验, 待 Edge 9222 真实 dump 后 verifiedOn/lastVerified 更新
 *   - NotLoggedInError 是设计预期: 没登录时 Router 自动 fallback 到下个 analyzer
 *
 * 借鉴:
 *   - BaseAnalyzer 抽象 (src/core/base-analyzer.mjs)
 *   - Kimi 框架 (src/analyzers/kimi.mjs) — 同样 contenteditable 模式
 */

import { BaseAnalyzer } from '../core/base-analyzer.mjs';
import { waitForElement, captureFailure } from '../core/selector.mjs';

export class ClaudeAnalyzer extends BaseAnalyzer {
  constructor(context, options = {}) {
    super(context, { platform: 'claude', ...options });
    this.url = 'https://claude.ai/chat';
  }

  /**
   * Claude.ai 平台特有 UI 交互逻辑, 继承基类的 analyze() retry 循环。
   */
  async _doAnalyze(video, attachments = []) {
    const page = await this.context.newPage();
    const log = this.logger;
    try {
      // 1. 跳到 Claude Chat
      await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // 2. 探测登录态: claude.ai 未登录会 redirect /login
      await this._detectLoginState(page);

      // 3. 等输入框出现
      const chatInput = page.locator(this.selectors.chatInput.primary);
      await chatInput.first().waitFor({ state: 'visible', timeout: 15000 });

      // 4. 填 prompt (ProseMirror contenteditable, 仿 Kimi 用 keyboard.type)
      const prompt = this.buildPrompt(video);
      await this._fillProseMirror(page, chatInput, prompt);

      // 5. 点击发送 + 等回复
      await this._clickSendButton(page);
      const responseText = await this._waitForResponse(page);

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
   * Claude 特有 — 探测是否登录。
   * 未登录: 跳到 /login, 抛 NotLoggedInError 由 Router 自动 fallback。
   */
  async _detectLoginState(page) {
    const url = page.url();
    if (url.includes('/login') || url.includes('/sign-in')) {
      throw new (await import('../core/analyzer-errors.mjs')).NotLoggedInError(
        'claude',
        'claude.ai redirected to /login — user must log in first'
      );
    }
    // 双保险: 找登录按钮
    try {
      const loginBtn = page.locator(this.selectors.loginButton.primary);
      await loginBtn.waitFor({ state: 'visible', timeout: 2000 });
      // 看到了登录按钮 → 大概率没登录
      throw new (await import('../core/analyzer-errors.mjs')).NotLoggedInError(
        'claude',
        'login button visible on claude.ai — user must log in first'
      );
    } catch (e) {
      if (e.code === 'NOT_LOGGED_IN') throw e;
      // 没看到登录按钮 → 假设已登录
    }
  }

  /**
   * Claude 特有 — ProseMirror contenteditable 填充。
   * 借 Kimi 的 lexical 经验 (keyboard.type 触发 input 事件)。
   */
  async _fillProseMirror(page, locator, text) {
    await locator.click();
    await new Promise(r => setTimeout(r, 300));
    // 清空已有内容
    await page.keyboard.press('Control+a');
    await new Promise(r => setTimeout(r, 100));
    await page.keyboard.press('Delete');
    await new Promise(r => setTimeout(r, 200));

    // 逐字符输入 (ProseMirror 监听 input 事件)
    const maxLen = Math.min(text.length, 1800);
    for (let i = 0; i < maxLen; i++) {
      await page.keyboard.type(text[i], { delay: 5 });
    }

    // 验证已填入
    const filled = await locator.evaluate(el => el.textContent || '');
    if (filled.trim().length < 10) {
      throw new Error('Claude ProseMirror fill failed — content too short');
    }
  }

  /**
   * Claude 特有 — 点击发送按钮或按 Enter 回退。
   */
  async _clickSendButton(page) {
    const sendBtn = page.locator(this.selectors.sendButton.primary);
    try {
      await sendBtn.first().waitFor({ state: 'visible', timeout: 5000 });
      await sendBtn.click();
    } catch {
      this.logger.warn({}, 'Claude send button not found, pressing Enter');
      await page.keyboard.press('Enter');
    }
  }

  /**
   * Claude 特有 — 等待 AI 回复出现。
   * Claude 回复可能嵌入 markdown / 代码块 / 工具调用——简单版取最后一条 assistant message。
   */
  async _waitForResponse(page) {
    // Claude 响应通常 < 60s 出第一条, 整体回答 < 3min
    const responseContainer = page.locator(this.selectors.responseContainer.primary);
    await responseContainer.first().waitFor({ state: 'visible', timeout: 120000 });
    // 等回复不再增长 (简单版: 等 5s 后取最后一条)
    await new Promise(r => setTimeout(r, 5000));
    const text = await responseContainer.first().textContent();
    return text || '';
  }

  /**
   * Claude 简化 prompt (借 Kimi 模式: URL + '帮我详细分析这个视频')
   */
  buildPrompt(video) {
    return `${video.url}\n帮我详细分析这个视频`;
  }
}
