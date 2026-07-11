/**
 * Gemini Analyzer — Placeholder stub
 *
 * SeniorDeveloper: 创建 stub 修复 web-agent.mjs import 缺失问题。
 * Gemini 真实实现计划在后续 Round 中完成。
 * 当前抛 AnalyzerUnavailableError，被 Router 自动 skip。
 */

import { BaseAnalyzer } from '../core/base-analyzer.mjs';
import { AnalyzerUnavailableError } from '../core/analyzer-errors.mjs';

export class GeminiAnalyzer extends BaseAnalyzer {
  constructor(context, options = {}) {
    super(context, { platform: 'gemini', ...options });
    this.url = 'https://gemini.google.com';
  }

  async _doAnalyze(video, attachments = []) {
    throw new AnalyzerUnavailableError('gemini', 'not yet implemented');
  }

  buildPrompt() {
    throw new Error('GeminiAnalyzer: not yet implemented');
  }
}
