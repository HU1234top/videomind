/**
 * Kimi Analyzer — Use Kimi (kimi.com) as Web-SubAgent for video analysis
 *
 * Round 10 (Phase B Task 2): Kimi Analyzer 真实实现
 * 原始实现由 MiniMax M3 完成，SeniorDeveloper 重构为继承 BaseAnalyzer 消除重复。
 *
 * Kimi vs Doubao 关键差异：
 *   - URL: https://www.kimi.com/ (kimi.ai 自动跳转)
 *   - chat input 是 contenteditable div，**不能用 .fill() 直接填**
 *   - 发送按钮在 chat-editor-action 容器内，输入文本后才激活
 *
 * 实现策略：contenteditable 用 page.evaluate 设 innerHTML + 触发 input 事件
 *           （Lexical editor 监听 input 事件更新内部 state）
 */

import { BaseAnalyzer } from '../core/base-analyzer.mjs';
import { uploadThumbToEditor } from '../core/thumb-upload.mjs';

export class KimiAnalyzer extends BaseAnalyzer {
  constructor(context, options = {}) {
    // SeniorDeveloper: 基类接管 retry/limiter/logger/selectors/JSON解析
    super(context, { platform: 'kimi', ...options });
    this.url = 'https://www.kimi.com/';
  }

  /**
   * SeniorDeveloper: 纯平台特有 UI 交互逻辑，继承基类的 analyze() retry 循环。
   */
  async _doAnalyze(video, attachments = []) {
    const page = await this.context.newPage();
    const log = this.logger;
    try {
      await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // 关登录弹窗（首次 chat 时强制弹）
      await this._dismissLoginModal(page);

      // 等输入框出现
      const chatInput = page.locator(this.selectors.chatInput.primary);
      await chatInput.waitFor({ state: 'visible', timeout: 15000 });

      // Round 22 / Round 11 复活: 上传缩略图 (抖音 URL 被反爬虫, 缩略图是 AI 唯一能 '看' 的)
      if (video.thumb || video.cover_url) {
        await uploadThumbToEditor(page, chatInput, video, {
          editorSelector: 'div.chat-input-editor[contenteditable="true"]',
          logger: log
        });
      }

      const prompt = this.buildPrompt(video);
      await this._fillContentEditable(page, chatInput, prompt);

      // 等 send button 激活 + 点击
      await this._clickSendButton(page);

      // 等回复
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
   * SeniorDeveloper: Kimi 专属 — Lexical editor 的 contenteditable 填充
   * MiniMax M3 原始逻辑（Round 10），保留不动。
   */
  async _fillContentEditable(page, locator, text) {
    await locator.click();
    await new Promise(r => setTimeout(r, 300));
    // 全选 + 删除已有内容
    await page.keyboard.press('Control+a');
    await new Promise(r => setTimeout(r, 100));
    await page.keyboard.press('Delete');
    await new Promise(r => setTimeout(r, 200));

    // 逐字符输入（Lexical 需要 input 事件）
    const maxLen = Math.min(text.length, 1800);
    for (let i = 0; i < maxLen; i++) {
      await page.keyboard.type(text[i], { delay: 5 });
    }

    // 验证已填入
    const filled = await locator.evaluate(el => el.textContent || '');
    if (filled.trim().length < 10) {
      throw new Error('Kimi contenteditable fill failed');
    }
  }

  /**
   * SeniorDeveloper: Kimi 专属 — 关登录弹窗（如果在 chat-editor-action 之前弹的话）
   */
  async _dismissLoginModal(page) {
    try {
      // 弹窗是一个覆盖层，找关闭按钮或点背景取消
      const closeBtn = page.locator('.modal-close-btn, [class*="close"], [class*="cancel"]').first();
      await closeBtn.waitFor({ state: 'visible', timeout: 3000 });
      await closeBtn.click();
      await new Promise(r => setTimeout(r, 1000));
    } catch {
      // 无弹窗，正常继续
    }
  }

  /**
   * SeniorDeveloper: Kimi 专属 — 点击发送按钮
   * 注意：Kimi 的 send button 是 div.send-button-container（不是 button）
   */
  async _clickSendButton(page) {
    const sendBtn = page.locator(this.selectors.sendButton.primary);
    try {
      await sendBtn.waitFor({ state: 'visible', timeout: 5000 });
      await sendBtn.click();
    } catch {
      // Fallback: 找不到按钮时尝试按 Enter
      this.logger.warn({}, 'send button not found, pressing Enter');
      await page.keyboard.press('Enter');
    }
  }

  /**
   * SeniorDeveloper: Kimi 专属 — 等待 AI 回复出现
   */
  async _waitForResponse(page) {
    const responseContainer = page.locator(this.selectors.responseContainer.primary);
    await responseContainer.waitFor({ state: 'visible', timeout: 120000 });
    // 等回复内容不再增长（简单版：等 5 秒后取内容）
    await new Promise(r => setTimeout(r, 5000));
    const text = await responseContainer.textContent();
    return text || '';
  }

  /**
   * SeniorDeveloper: Kimi 的简化 prompt（Round 10 用户建议）
   * 原始由 MiniMax M3 实现，59 字符。
   */
  buildPrompt(video) {
    return `${video.url}\n帮我详细分析这个视频`;
  }
}
