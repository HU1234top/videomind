/**
 * Doubao Analyzer — Use Doubao (doubao.com) as Web-SubAgent for video analysis
 *
 * MVP validated: 77/76 videos = 100% coverage (49 deep + 28 enhanced basic)
 *
 * SeniorDeveloper: 重构为继承 BaseAnalyzer，消除与 kimi.mjs 的重复代码。
 * 原始逻辑来自 MiniMax M3 (Round 4/8)，retry/JSON解析/10维输出移到基类。
 *
 * Round 8 改造:
 *   - 改用 selectors/doubao.json (配置化 selector + 备选链)
 *   - 改用 dom-watcher.mjs 智能等待 (替代硬编码 30s)
 */

import { BaseAnalyzer } from '../core/base-analyzer.mjs';
import { waitForBodyTextStable, waitForElementTextStable } from '../core/dom-watcher.mjs';
import { NotLoggedInError } from '../core/analyzer-errors.mjs';
import { uploadThumbToEditor } from '../core/thumb-upload.mjs';

export class DoubaoAnalyzer extends BaseAnalyzer {
  constructor(context, options = {}) {
    // SeniorDeveloper: 基类接管 context、limiter、logger、selectors 初始化
    super(context, { platform: 'doubao', ...options });
    this.url = 'https://doubao.com';
  }

  /**
   * Single attempt at analyzing a video.
   * SeniorDeveloper: 纯平台特有逻辑，retry 循环和解析由基类处理。
   */
  async _doAnalyze(video, attachments = []) {
    const page = await this.context.newPage();
    const log = this.logger;
    try {
      await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // SeniorDeveloper: Round 11 — 登录态检测，未登录时抛 NotLoggedInError
      // 让 Router 正确 fallback 到下一个 analyzer，而非浪费 retries
      await this._checkLoginState(page);

      // 等输入框出现 (替代硬编码 selector)
      const inputResult = await waitForElement(page, this.selectors.chatInput, {
        intervals: [3000, 5000],
        scrollTrigger: false,
        logger: log
      });
      if (!inputResult.element) {
        log?.error?.({ attempts: inputResult.attempts }, 'chat input not found');
        await captureFailure(page, 'no-chat-input', { logger: log });
        throw new Error('chat input not found — selectors/doubao.json may be outdated');
      }

      // Round 22 / Round 11 复活: 上传缩略图 (抖音 URL 被反爬虫, 缩略图是 AI 唯一能 '看' 的)
      if (video.thumb || video.cover_url) {
        await uploadThumbToEditor(page, inputResult.element, video, {
          editorSelector: 'textarea.semi-input-textarea, div[contenteditable="true"]',
          logger: log
        });
      }

      // 构造 prompt + 输入
      const prompt = this.buildPrompt(video);
      await inputResult.element.fill(prompt);
      await new Promise(r => setTimeout(r, 500));

      // 尝试找发送按钮，fallback 按 Enter
      const sendResult = await waitForElement(page, this.selectors.sendButton, {
        intervals: [1000, 2000],
        scrollTrigger: false,
        logger: log
      });
      if (sendResult.element) {
        await sendResult.element.click();
      } else {
        log?.warn?.({ prompt: prompt.slice(0, 50) }, 'no send button, pressing Enter');
        await inputResult.element.press('Enter');
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
          maxWaitMs: 600000,
          tailLength: 500
        });
        responseText = stable.text;
      } catch (e) {
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
   * SeniorDeveloper: Round 11 — 检测用户是否已登录 doubao.com
   *
   * 检查登录按钮等 UI 元素，如果页面处于未登录态则抛 NotLoggedInError。
   * 让 Router 正确 fallback 到 Kimi 等已登录的 analyzer，而非浪费 retries。
   *
   * 判定依据：未登录时 doubao.com 会在页面顶部显示登录/注册按钮或全屏登录引导页。
   */
  async _checkLoginState(page) {
    const loginSelectors = [
      'button:has-text("登录")',
      'a:has-text("登录")',
      'button:has-text("注册")',
      'button:has-text("免费使用")',
      '[class*="login"]',
      '[class*="LoginModal"]',
    ];

    for (const selector of loginSelectors) {
      try {
        const el = page.locator(selector).first();
        const visible = await el.isVisible({ timeout: 1000 }).catch(() => false);
        if (visible) {
          const text = (await el.textContent().catch(() => '')).trim().slice(0, 30);
          this.logger.info?.({ selector, text }, 'login button detected — user not logged in');
          // 截图保留现场
          await captureFailure(page, 'not-logged-in', { logger: this.logger }).catch(() => {});
          throw new NotLoggedInError('doubao', `login button visible: "${text}" (selector: ${selector})`);
        }
      } catch (e) {
        if (e instanceof NotLoggedInError) throw e;
        // 超时或元素不存在 → 正常，继续检查
      }
    }

    this.logger.debug({}, 'login state check passed — user appears logged in');
  }

  buildPrompt(video) {
    const videoTags = video.tags?.join(', ') || '无';
    const topComments = video.comments?.slice(0, 5).map(c =>
      typeof c === 'string' ? c : `${c.author}: ${c.text}`
    ).join('\n') || '无';
    // Round 22 / Round 11 复活: 提示 AI 已经收到封面图 + 评论
    const hasThumb = video.thumb || video.cover_url;

    return `你是一位技能拆解专家。请将以下视频当作一个「可学习的技能单元」来深度分析。

## 视频信息
- 标题：${video.title}
- 作者：${video.author}
- 话题标签：${videoTags}
- 精选评论：
${topComments}
- 语音转写：${video.transcript || '无'}
${hasThumb ? '- 已附上视频封面图 (抖音 CDN, 第一帧 + 文字信息), 结合图片和评论一起分析\n  注意: 因抖音 URL 反爬虫, 你可能无法 fetch 完整视频, 请基于封面图视觉信息 + 评论 + tags 综合推断' : '- 视频本体不可访问 (无封面图), 请仅基于标题/作者/标签/评论推断'}

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

{"skill_name":"...","skill_level":"入门|中级|高级|专家","key_points":["...", "..."],"action_steps":["...", "..."],"tools_resources":["...", "..."],"pitfalls":["...", "..."],"use_cases":"...","prerequisites":"...","learning_path":"...","transcript":"...","auto_tags":["#tag1", "#tag2"]}

- 字符串值用中文
- 数组值用 ["项1", "项2"] 格式
- 缺失信息填 "" 或 []
- **transcript 字段：把视频里所有听得到的口语逐字记录下来**（原话+关键旁白），如听不清可填"(听不清)"，但尽量用连贯的文段还原。如果视频里没有口头讲解，标"无旁白"
- 不要使用 markdown 代码块包裹
- 不要添加任何说明文字`;
  }
}
