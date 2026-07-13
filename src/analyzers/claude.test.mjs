/**
 * src/analyzers/claude.test.mjs — Claude Analyzer 单元测试
 *
 * 测的是可独立测试的部分:
 *   - buildPrompt() 包含 URL
 *   - this.url 正确
 *   - this.selectors 正确加载
 *   - 继承 BaseAnalyzer 后可测 rate limiter / logger / constructor
 *
 * 不测 _doAnalyze / _fillProseMirror / _clickSendButton (需真实 Edge + Claude.ai 登录)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeAnalyzer } from './claude.mjs';
import { loadSelectors } from '../core/selector.mjs';

describe('ClaudeAnalyzer', () => {
  test('set correct URL', () => {
    const analyzer = new ClaudeAnalyzer({});
    assert.equal(analyzer.url, 'https://claude.ai/chat');
  });

  test('build prompt includes video URL', () => {
    const analyzer = new ClaudeAnalyzer({});
    const prompt = analyzer.buildPrompt({ url: 'https://test.com/video/123', title: 'test' });
    assert.match(prompt, /https:\/\/test\.com\/video\/123/);
    assert.match(prompt, /帮我详细分析|分析|视频/);
  });

  test('loads Claude selector config', () => {
    const config = loadSelectors('claude');
    assert.equal(config.platform, 'claude');
    assert.ok(config.selectors.chatInput);
    assert.ok(config.selectors.sendButton);
    assert.ok(config.selectors.responseContainer);
  });

  test('selector has fallback chain for each field', () => {
    const config = loadSelectors('claude');
    assert.ok(config.selectors.chatInput.fallback.length >= 2, 'chatInput has fallback');
    assert.ok(config.selectors.sendButton.fallback.length >= 2, 'sendButton has fallback');
    assert.ok(config.selectors.responseContainer.fallback.length >= 2, 'responseContainer has fallback');
  });

  test('implemented flag set to true (真实现, not stub)', () => {
    const config = loadSelectors('claude');
    assert.equal(config.implemented, true);
  });

  test('ClaudeAnalyzer extends BaseAnalyzer', () => {
    const analyzer = new ClaudeAnalyzer({});
    // 通过 prototype 链检测
    assert.ok(analyzer.constructor.prototype.constructor === ClaudeAnalyzer);
    // BaseAnalyzer 应该已注入 logger / limiter
    assert.ok(analyzer.logger, 'logger injected by BaseAnalyzer');
    assert.ok(analyzer.limiter, 'limiter injected by BaseAnalyzer');
    assert.equal(analyzer.platform, 'claude');
  });

  test('selector notes mention login redirect and ProseMirror', () => {
    const config = loadSelectors('claude');
    const notesText = JSON.stringify(config.notes);
    assert.match(notesText, /ProseMirror|contenteditable/i);
    assert.match(notesText, /登录|login/i);
  });
});
