/**
 * src/core/selector.test.mjs — selector 系统单测
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSelectors, resolveSelector, selectorChain } from './selector.mjs';

describe('loadSelectors', () => {
  test('loads valid douyin.json from selectors/ dir', () => {
    const cfg = loadSelectors('douyin');
    assert.ok(cfg.version, 'should have version');
    assert.ok(cfg.selectors, 'should have selectors field');
    assert.ok(cfg.selectors.videoCard, 'should have videoCard selector');
  });

  test('selector config has primary + fallback structure', () => {
    const cfg = loadSelectors('douyin');
    const card = cfg.selectors.videoCard;
    assert.ok(card.primary, 'videoCard should have primary');
    assert.ok(Array.isArray(card.fallback), 'fallback should be array');
  });

  test('throws on missing platform', () => {
    assert.throws(() => loadSelectors('nonexistent'));
  });
});

describe('resolveSelector', () => {
  test('returns primary when given object config', () => {
    const cfg = { primary: '[data-e2e="foo"]', fallback: ['[data-e2e="bar"]'] };
    assert.equal(resolveSelector(cfg), '[data-e2e="foo"]');
  });

  test('returns string as-is when given plain string', () => {
    assert.equal(resolveSelector('[data-e2e="foo"]'), '[data-e2e="foo"]');
  });

  test('returns null for null/undefined', () => {
    assert.equal(resolveSelector(null), null);
    assert.equal(resolveSelector(undefined), null);
  });
});

describe('selectorChain', () => {
  test('returns [primary, ...fallback]', () => {
    const cfg = {
      primary: 'a',
      fallback: ['b', 'c']
    };
    assert.deepEqual(selectorChain(cfg), ['a', 'b', 'c']);
  });

  test('returns just [primary] when fallback missing', () => {
    assert.deepEqual(selectorChain({ primary: 'x' }), ['x']);
  });

  test('plain string returns single-element array', () => {
    assert.deepEqual(selectorChain('x'), ['x']);
  });

  test('null returns empty array', () => {
    assert.deepEqual(selectorChain(null), []);
  });
});

describe('waitForElement — failure path', () => {
  test('returns null when no selector matches', async () => {
    // Mock page that always times out
    const mockPage = {
      waitForSelector: async () => {
        throw new Error('timeout');
      },
      evaluate: async () => 0,
      locator: () => ({ count: async () => 0 })
    };

    const { waitForElement } = await import('./selector.mjs');
    const result = await waitForElement(
      mockPage,
      { primary: '.nonexistent', fallback: ['.also-nonexistent'] },
      { intervals: [100, 200], scrollTrigger: false }
    );

    assert.equal(result.element, null);
    assert.equal(result.selector, null);
    assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0].success, false);
  });
});

describe('captureFailure — error handling', () => {
  test('returns null gracefully when screenshot fails', async () => {
    const mockPage = {
      screenshot: async () => { throw new Error('screenshot failed'); }
    };

    const { captureFailure } = await import('./selector.mjs');
    const logger = {
      warn: () => {},
      debug: () => {}
    };

    const tmpRoot = mkdtempSync(join(tmpdir(), 'sel-test-'));
    try {
      const result = await captureFailure(mockPage, 'test-failure', {
        root: tmpRoot,
        logger,
        keepLastNRuns: 1
      });
      assert.equal(result, null);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe('integration: load real douyin selectors', () => {
  test('all selectors in douyin.json are parseable', () => {
    const cfg = loadSelectors('douyin');
    for (const [name, sel] of Object.entries(cfg.selectors)) {
      assert.ok(sel.primary, `${name} should have primary`);
      const chain = selectorChain(sel);
      assert.ok(chain.length > 0, `${name} should have at least primary`);
    }
  });

  test('douyin.json reflects real selectors from Edge dump', () => {
    const cfg = loadSelectors('douyin');
    // These are the e2e-validated selectors from research/douyin-selectors-raw.json
    assert.equal(
      cfg.selectors.favoritesTab.primary,
      "[data-e2e='user-favorite-tab']",
      'favoritesTab should use user-favorite-tab (not user-favorites, which is broken)'
    );
    assert.equal(
      cfg.selectors.videoCard.primary,
      "[data-e2e='user-post-list'] li",
      'videoCard should use user-post-list li (verified structure)'
    );
  });
});