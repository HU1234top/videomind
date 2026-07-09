/**
 * VideoMind Core — Web Agent abstraction layer
 *
 * Connects to user's local Chrome via CDP, wraps web AI platforms
 * as callable SubAgents.
 *
 * IMPORTANT: disconnect() uses browser.disconnect() (not close()),
 * because we connect to the user's real browser — close() would kill it.
 */

import { DoubaoAnalyzer } from '../analyzers/doubao.mjs';

export class WebAgent {
  constructor(options = {}) {
    this.cdpPort = options.cdpPort || 9222;
    this.browser = null;
    this.context = null;
  }

  async connect() {
    const { chromium } = await import('playwright-core');
    this.browser = await chromium.connectOverCDP(`http://localhost:${this.cdpPort}`);
    this.context = this.browser.contexts()[0] || await this.browser.newContext();
    return this;
  }

  /**
   * Send content to a web AI platform for analysis.
   * @param {string} platform - Analyzer name (doubao, kimi, etc.)
   * @param {Object} video - Video metadata object (title, author, comments, transcript, tags)
   * @param {Object} options - Additional options (attachments, retryCount, etc.)
   * @returns {Object} Structured analysis result
   */
  async sendToAI(platform, video, options = {}) {
    const analyzer = AnalyzerFactory.create(platform, this.context);
    return analyzer.analyze(video, options);
  }

  async disconnect() {
    if (this.browser) {
      // Use disconnect() not close() — we connected to user's
      // real browser via CDP, close() would kill their Chrome!
      await this.browser.disconnect();
    }
  }
}

export class AnalyzerFactory {
  static create(platform, context) {
    switch (platform) {
      case 'doubao':
        return new DoubaoAnalyzer(context);
      case 'kimi':
        throw new Error('Kimi analyzer not yet implemented — see Phase 2 roadmap');
      case 'gemini':
        throw new Error('Gemini analyzer not yet implemented — see Phase 2 roadmap');
      case 'claude':
        throw new Error('Claude analyzer not yet implemented — see Phase 2 roadmap');
      default:
        throw new Error(`Unknown analyzer: ${platform}`);
    }
  }
}
