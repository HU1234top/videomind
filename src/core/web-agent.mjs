/**
 * VideoMind Core — Web Agent abstraction layer
 *
 * Connects to user's local Chrome via CDP, wraps web AI platforms
 * as callable SubAgents.
 *
 * Round 9 改造:
 *   1. AnalyzerFactory 改为 import src/analyzers/*.mjs 真实实现
 *   2. 内部占位 analyzer 类删除（移到 analyzers/ 目录）
 *   3. AnalyzerFactory.all() 暴露完整 registry 给 Router
 *   4. disconnect() 红线修复：不调 browser.close()，避免杀掉用户真实 Edge
 */

import { createLogger } from './logger.mjs';
import { DoubaoAnalyzer } from '../analyzers/doubao.mjs';
import { KimiAnalyzer } from '../analyzers/kimi.mjs';

export class WebAgent {
  constructor(options = {}) {
    this.cdpPort = options.cdpPort || 9222;
    this.browser = null;
    this.context = null;
    this.logger = options.logger || createLogger({ base: { component: 'web-agent' } });
  }

  async connect() {
    // Connect to existing Chrome instance via CDP
    const { chromium } = await import('playwright-core');
    this.browser = await chromium.connectOverCDP(`http://localhost:${this.cdpPort}`);
    this.context = this.browser.contexts()[0] || await this.browser.newContext();
    return this;
  }

  async sendToAI(platform, content, attachments = []) {
    const analyzer = AnalyzerFactory.create(platform, this.context, { logger: this.logger });
    return analyzer.analyze(content, attachments);
  }

  /**
   * 安全断开：不杀掉用户浏览器。
   *
   * ⚠️ 红线：绝对不调用 browser.close() —— 那会杀掉用户真实的 Edge/Chrome 实例。
   * 我们只关闭自己在 context 里打开的 page。
   */
  async disconnect() {
    if (!this.browser) return;
    try {
      for (const ctx of this.browser.contexts()) {
        for (const page of ctx.pages()) {
          await page.close().catch(() => {}); // swallow "already closed"
        }
      }
      this.logger.debug({ stage: 'disconnect' }, 'pages closed, browser left running for user');
    } catch (e) {
      this.logger.warn?.({ stage: 'disconnect', err: e.message }, 'disconnect cleanup failed');
    }
    // 故意不调 browser.close() —— 那是项目红线
    this.browser = null;
    this.context = null;
  }
}

/**
 * Analyzer Registry — 真实实现类映射
 *
 * Round 9：从 web-agent.mjs 内部的占位类改为 import 真实 analyzer。
 * 占位 analyzer (kimi/gemini/claude) 在 analyze() 中抛 AnalyzerUnavailableError，
 * Router 收到后自动 skip 到下一个。
 */
const ANALYZER_REGISTRY = {
  doubao: DoubaoAnalyzer,
  kimi: KimiAnalyzer,
};

export class AnalyzerFactory {
  /**
   * 创建 analyzer 实例
   * @param {string} platform - 'doubao' | 'kimi' | 'gemini' | 'claude'
   * @param {Object} context - Playwright BrowserContext
   * @param {Object} [options] - 注入选项 (logger 等)
   */
  static create(platform, context, options = {}) {
    const Ctor = ANALYZER_REGISTRY[platform];
    if (!Ctor) throw new Error(`Unknown analyzer: ${platform}`);
    return new Ctor(context, options);
  }

  /**
   * 暴露完整 registry（供 AnalyzerRouter 使用）
   */
  static all() {
    return { ...ANALYZER_REGISTRY };
  }

  /**
   * 返回支持的 analyzer 名称列表
   */
  static names() {
    return Object.keys(ANALYZER_REGISTRY);
  }
}