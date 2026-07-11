/**
 * Claude Analyzer — Placeholder stub
 *
 * SeniorDeveloper: 创建 stub 修复 web-agent.mjs import 缺失问题。
 * Claude 真实实现计划在后续 Round 中完成。
 * 当前抛 AnalyzerUnavailableError，被 Router 自动 skip。
 */

import { BaseAnalyzer } from '../core/base-analyzer.mjs';
import { AnalyzerUnavailableError } from '../core/analyzer-errors.mjs';

export class ClaudeAnalyzer extends BaseAnalyzer {
  constructor(context, options = {}) {
    super(context, { platform: 'claude', ...options });
    this.url = 'https://claude.ai';
  }

  async _doAnalyze(video, attachments = []) {
    throw new AnalyzerUnavailableError('claude', 'not yet implemented');
  }

  buildPrompt() {
    throw new Error('ClaudeAnalyzer: not yet implemented');
  }
}
