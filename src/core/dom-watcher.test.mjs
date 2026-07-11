/**
 * src/core/dom-watcher.test.mjs — dom-watcher 智能等待单测
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { waitForBodyTextStable, waitForElementTextStable, detectResponseStarted } from './dom-watcher.mjs';

describe('waitForBodyTextStable', () => {
  test('returns immediately when text is stable from the start', async () => {
    let currentText = 'Hello World';
    const mockPage = {
      evaluate: async () => currentText
    };
    // 设 text 不变, 3 次 (24s) 后返回
    // 但用更短 interval 加快测试
    const result = await waitForBodyTextStable(mockPage, {
      pollIntervalMs: 50,
      stableCount: 3,
      maxWaitMs: 5000,
      tailLength: 100
    });
    assert.equal(result, 'Hello World');
  });

  test('waits for text to stabilize after changes', async () => {
    let callCount = 0;
    const texts = [
      'starting...',     // 0
      'generating...',   // 1
      'generating 50%',  // 2
      'generating 50%',  // 3
      'generating 50%'   // 4 (stable)
    ];
    const mockPage = {
      evaluate: async () => texts[Math.min(callCount++, texts.length - 1)]
    };
    const result = await waitForBodyTextStable(mockPage, {
      pollIntervalMs: 30,
      stableCount: 3,
      maxWaitMs: 5000,
      tailLength: 50
    });
    assert.match(result, /generating/);
  });

  test('throws on timeout when text keeps changing', async () => {
    let counter = 0;
    const mockPage = {
      evaluate: async () => `text-${counter++}`
    };
    await assert.rejects(
      waitForBodyTextStable(mockPage, {
        pollIntervalMs: 30,
        stableCount: 3,
        maxWaitMs: 200,  // 短超时
        tailLength: 10
      }),
      /timeout/
    );
  });
});

describe('waitForElementTextStable', () => {
  test('returns element + text when stable', async () => {
    // mock 链: page.locator(sel).last() 返回一个 element handle,
    // 该 handle 自带 textContent() 方法 (Playwright Locator 行为)
    const fakeElementHandle = {
      textContent: async () => 'AI response content'
    };
    const mockPage = {
      locator: () => ({
        last: async () => fakeElementHandle
      })
    };
    const result = await waitForElementTextStable(mockPage, '.response', {
      pollIntervalMs: 30,
      stableCount: 2,
      maxWaitMs: 5000,
      tailLength: 100
    });
    assert.equal(result.element, fakeElementHandle);
    assert.match(result.text, /AI response/);
  });

  test('throws on timeout when element never appears', async () => {
    const mockPage = {
      locator: () => ({
        last: async () => { throw new Error('element not found'); }
      })
    };
    await assert.rejects(
      waitForElementTextStable(mockPage, '.nonexistent', {
        pollIntervalMs: 30,
        stableCount: 2,
        maxWaitMs: 200
      }),
      /timeout/
    );
  });
});

describe('detectResponseStarted', () => {
  test('returns true when prompt marker found with enough following text', async () => {
    const mockPage = {
      evaluate: async () => true
    };
    const result = await detectResponseStarted(mockPage, '请分析', 100);
    assert.equal(result, true);
  });

  test('returns false when prompt marker not found', async () => {
    const mockPage = {
      evaluate: async () => false
    };
    const result = await detectResponseStarted(mockPage, '请分析', 100);
    assert.equal(result, false);
  });
});

describe('integration: stable after dynamic growth', () => {
  test('simulates AI response gradually growing then stable', async () => {
    // 模拟 WorkBuddy 真实场景: 豆包逐步生成, 最后稳定
    let n = 0;
    const responses = [
      '',                                              // 0: 还没开始
      '正在思考',                                       // 1
      '正在思考...这是第一段',                            // 2
      '正在思考...这是第一段。\n\n这是第二段内容。',      // 3
      '正在思考...这是第一段。\n\n这是第二段内容。\n\n第三段', // 4
      '正在思考...这是第一段。\n\n这是第二段内容。\n\n第三段', // 5 (与 4 相同)
      '正在思考...这是第一段。\n\n这是第二段内容。\n\n第三段', // 6 (与 4 相同)
      '正在思考...这是第一段。\n\n这是第二段内容。\n\n第三段'  // 7 (与 4 相同 = stable)
    ];
    const mockPage = {
      evaluate: async () => responses[Math.min(n++, responses.length - 1)]
    };
    const result = await waitForBodyTextStable(mockPage, {
      pollIntervalMs: 10,
      stableCount: 3,
      maxWaitMs: 5000,
      tailLength: 200
    });
    // 最终返回稳定的内容
    assert.match(result, /第三段/);
  });
});