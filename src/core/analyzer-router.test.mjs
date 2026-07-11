/**
 * src/core/analyzer-router.test.mjs — Analyzer Router 单测
 *
 * 用 stub analyzer 验证 Router 路由决策：
 *   - primary 成功 → 不调 fallback
 *   - primary UNAVAILABLE → skip → next
 *   - 全失败 → AnalyzerUnreachableError
 *   - CAPTCHA → abort 不继续
 *   - chain 去重
 *   - attachments 透传
 *   - NotLoggedInError 分类
 *   - classify() 矩阵
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AnalyzerRouter } from './analyzer-router.mjs';
import {
  AnalyzerUnavailableError,
  NotLoggedInError,
  AnalyzerUnreachableError
} from './analyzer-errors.mjs';

// ─── Stub Analyzer 工厂 ────────────────────────────────────────────

/**
 * 创建 stub analyzer class
 * @param {Object} opts - { behavior, name, callCount }
 *   behavior: 'success' | 'unavailable' | 'notLoggedIn' | 'captcha' | 'genericError' | 'empty'
 */
function makeStub({ name, behavior, result, throwErr }) {
  const stub = function StubAnalyzer() {};
  stub.prototype.analyze = async (video, attachments) => {
    stub.callCount = (stub.callCount || 0) + 1;
    stub.lastVideo = video;
    stub.lastAttachments = attachments;
    if (throwErr) throw throwErr;
    if (behavior === 'success') return result || { analysis: 'ok', dimensions: {} };
    if (behavior === 'empty') return { analysis: '', dimensions: {} };
    return null;
  };
  return stub;
}

// ─── 基础构造 ────────────────────────────────────────────

describe('AnalyzerRouter — construction', () => {
  test('accepts logger injection', () => {
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => logger };
    const router = new AnalyzerRouter({
      registry: { doubao: makeStub({ name: 'doubao', behavior: 'success' }) },
      primary: 'doubao',
      logger
    });
    assert.equal(router.logger, logger);
  });

  test('throws when registry missing', () => {
    assert.throws(() => new AnalyzerRouter({ primary: 'doubao' }), /registry is required/);
  });

  test('throws when primary missing', () => {
    assert.throws(() => new AnalyzerRouter({ registry: {} }), /primary is required/);
  });

  test('chain getter dedupes primary vs fallback', () => {
    const router = new AnalyzerRouter({
      registry: {},
      primary: 'doubao',
      fallback: ['doubao', 'kimi', 'kimi', 'gemini']
    });
    assert.deepEqual(router.chain, ['doubao', 'kimi', 'gemini']);
  });

  test('chain getter excludes primary from fallback', () => {
    const router = new AnalyzerRouter({
      registry: {},
      primary: 'doubao',
      fallback: ['kimi', 'gemini']
    });
    assert.deepEqual(router.chain, ['doubao', 'kimi', 'gemini']);
  });

  test('chain getter works without fallback', () => {
    const router = new AnalyzerRouter({
      registry: {},
      primary: 'doubao'
    });
    assert.deepEqual(router.chain, ['doubao']);
  });
});

// ─── 路由行为 ────────────────────────────────────────────

describe('AnalyzerRouter.route — primary success', () => {
  test('returns primary result without invoking fallback', async () => {
    const doubaoStub = makeStub({ name: 'doubao', behavior: 'success', result: { analysis: 'doubao result' } });
    const kimiStub = makeStub({ name: 'kimi', behavior: 'success' });

    const router = new AnalyzerRouter({
      registry: { doubao: doubaoStub, kimi: kimiStub },
      primary: 'doubao',
      fallback: ['kimi']
    });

    const result = await router.route({ url: 'https://test/v1', title: 't' });
    assert.equal(result.analysis, 'doubao result');
    assert.equal(doubaoStub.callCount, 1);
    assert.equal(kimiStub.callCount ?? 0, 0, 'fallback should NOT be called');
  });
});

describe('AnalyzerRouter.route — primary UNAVAILABLE → skip to next', () => {
  test('skips UNAVAILABLE analyzer and tries next', async () => {
    const doubaoStub = makeStub({ name: 'doubao', behavior: 'unavailable' });
    doubaoStub.prototype.analyze = async () => {
      doubaoStub.callCount = (doubaoStub.callCount || 0) + 1;
      throw new AnalyzerUnavailableError('doubao', 'not yet implemented');
    };
    const kimiStub = makeStub({ name: 'kimi', behavior: 'success', result: { analysis: 'kimi result' } });

    const router = new AnalyzerRouter({
      registry: { doubao: doubaoStub, kimi: kimiStub },
      primary: 'doubao',
      fallback: ['kimi']
    });

    const result = await router.route({ url: 'https://test/v1', title: 't' });
    assert.equal(result.analysis, 'kimi result');
    assert.equal(doubaoStub.callCount, 1);
    assert.equal(kimiStub.callCount, 1);
  });
});

describe('AnalyzerRouter.route — NotLoggedInError → skip', () => {
  test('NotLoggedInError causes skip to next analyzer', async () => {
    const doubaoStub = makeStub({ name: 'doubao', behavior: 'notLoggedIn' });
    doubaoStub.prototype.analyze = async () => {
      doubaoStub.callCount = (doubaoStub.callCount || 0) + 1;
      throw new NotLoggedInError('doubao', 'login button visible');
    };
    const kimiStub = makeStub({ name: 'kimi', behavior: 'success' });

    const router = new AnalyzerRouter({
      registry: { doubao: doubaoStub, kimi: kimiStub },
      primary: 'doubao',
      fallback: ['kimi']
    });

    const result = await router.route({ url: 'https://test/v1', title: 't' });
    assert.equal(result.analysis, 'ok');
    assert.equal(doubaoStub.callCount, 1);
    assert.equal(kimiStub.callCount, 1);
  });
});

describe('AnalyzerRouter.route — CAPTCHA → abort, no fallback', () => {
  test('CAPTCHA_DETECTED error aborts immediately', async () => {
    const doubaoStub = makeStub({ name: 'doubao', behavior: 'captcha' });
    doubaoStub.prototype.analyze = async () => {
      doubaoStub.callCount = (doubaoStub.callCount || 0) + 1;
      const e = new Error('captcha');
      e.code = 'CAPTCHA_DETECTED';
      throw e;
    };
    const kimiStub = makeStub({ name: 'kimi', behavior: 'success' });

    const router = new AnalyzerRouter({
      registry: { doubao: doubaoStub, kimi: kimiStub },
      primary: 'doubao',
      fallback: ['kimi']
    });

    await assert.rejects(
      router.route({ url: 'https://test/v1', title: 't' }),
      /captcha/
    );
    assert.equal(doubaoStub.callCount, 1);
    assert.equal(kimiStub.callCount ?? 0, 0, 'CAPTCHA should not trigger fallback');
  });
});

describe('AnalyzerRouter.route — all fail', () => {
  test('throws AnalyzerUnreachableError when all analyzers fail', async () => {
    const doubaoStub = makeStub({ name: 'doubao', behavior: 'unavailable' });
    doubaoStub.prototype.analyze = async () => { throw new AnalyzerUnavailableError('doubao', 'x'); };
    const kimiStub = makeStub({ name: 'kimi', behavior: 'unavailable' });
    kimiStub.prototype.analyze = async () => { throw new AnalyzerUnavailableError('kimi', 'x'); };
    const geminiStub = makeStub({ name: 'gemini', behavior: 'unavailable' });
    geminiStub.prototype.analyze = async () => { throw new AnalyzerUnavailableError('gemini', 'x'); };

    const router = new AnalyzerRouter({
      registry: { doubao: doubaoStub, kimi: kimiStub, gemini: geminiStub },
      primary: 'doubao',
      fallback: ['kimi', 'gemini']
    });

    try {
      await router.route({ url: 'https://test/v1', title: 't' });
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e instanceof AnalyzerUnreachableError);
      assert.equal(e.code, 'UNREACHABLE');
      assert.equal(e.attempts.length, 3);
      assert.equal(e.attempts[0].name, 'doubao');
      assert.equal(e.attempts[1].name, 'kimi');
      assert.equal(e.attempts[2].name, 'gemini');
    }
  });
});

describe('AnalyzerRouter.route — generic error triggers fallback', () => {
  test('non-classified error falls through to next analyzer', async () => {
    const doubaoStub = makeStub({ name: 'doubao', behavior: 'genericError' });
    doubaoStub.prototype.analyze = async () => { throw new Error('network timeout'); };
    const kimiStub = makeStub({ name: 'kimi', behavior: 'success', result: { analysis: 'kimi ok' } });

    const router = new AnalyzerRouter({
      registry: { doubao: doubaoStub, kimi: kimiStub },
      primary: 'doubao',
      fallback: ['kimi']
    });

    const result = await router.route({ url: 'https://test/v1', title: 't' });
    assert.equal(result.analysis, 'kimi ok');
  });
});

describe('AnalyzerRouter.route — analyzer not in registry', () => {
  test('skips analyzer names not present in registry', async () => {
    const doubaoStub = makeStub({ name: 'doubao', behavior: 'success' });
    const router = new AnalyzerRouter({
      registry: { doubao: doubaoStub }, // kimi NOT in registry
      primary: 'doubao',
      fallback: ['kimi'] // should be skipped
    });

    const result = await router.route({ url: 'https://test/v1', title: 't' });
    assert.equal(result.analysis, 'ok');
    assert.equal(doubaoStub.callCount, 1);
  });
});

describe('AnalyzerRouter.route — empty result treated as failure', () => {
  test('analyzer returning empty .analysis falls through', async () => {
    const doubaoStub = makeStub({ name: 'doubao', behavior: 'empty' });
    const kimiStub = makeStub({ name: 'kimi', behavior: 'success' });

    const router = new AnalyzerRouter({
      registry: { doubao: doubaoStub, kimi: kimiStub },
      primary: 'doubao',
      fallback: ['kimi']
    });

    const result = await router.route({ url: 'https://test/v1', title: 't' });
    assert.equal(result.analysis, 'ok');
    assert.equal(kimiStub.callCount, 1, 'empty result should trigger fallback');
  });
});

describe('AnalyzerRouter.route — attachments passthrough', () => {
  test('passes attachments to analyzer.analyze', async () => {
    const doubaoStub = makeStub({ name: 'doubao', behavior: 'success' });
    const router = new AnalyzerRouter({
      registry: { doubao: doubaoStub },
      primary: 'doubao'
    });

    const attachments = [{ type: 'screenshot', path: '/tmp/x.png' }];
    await router.route({ url: 'https://test/v1', title: 't' }, attachments);

    assert.deepEqual(doubaoStub.lastAttachments, attachments);
  });
});

describe('AnalyzerRouter.route — checkpoint integration', () => {
  test('skips analyzer if checkpoint says max retries exceeded', async () => {
    const doubaoStub = makeStub({ name: 'doubao', behavior: 'success' });
    const kimiStub = makeStub({ name: 'kimi', behavior: 'success' });
    const fakeCheckpoint = {
      markInProgress: () => false, // simulate max retries
      markCompleted: () => {},
      markFailed: () => {}
    };

    const router = new AnalyzerRouter({
      registry: { doubao: doubaoStub, kimi: kimiStub },
      primary: 'doubao',
      fallback: ['kimi'],
      checkpoint: fakeCheckpoint
    });

    try {
      await router.route({ url: 'https://test/v1', title: 't' });
      assert.fail('should throw');
    } catch (e) {
      assert.ok(e instanceof AnalyzerUnreachableError);
      assert.equal(doubaoStub.callCount ?? 0, 0, 'checkpoint should block analyzer');
      assert.equal(kimiStub.callCount ?? 0, 0);
    }
  });

  test('returns cached result if checkpoint.isCompleted', async () => {
    const doubaoStub = makeStub({ name: 'doubao', behavior: 'success' });
    const cached = { analysis: 'cached result', dimensions: {} };
    const fakeCheckpoint = {
      isCompleted: () => true,
      getCachedResult: () => cached
    };

    const router = new AnalyzerRouter({
      registry: { doubao: doubaoStub },
      primary: 'doubao',
      checkpoint: fakeCheckpoint
    });

    const result = await router.route({ url: 'https://test/v1', title: 't' });
    assert.equal(result.analysis, 'cached result');
    assert.equal(doubaoStub.callCount ?? 0, 0, 'cached result should skip analyzer');
  });
});

describe('AnalyzerRouter.route — required arguments', () => {
  test('throws if video.url missing', async () => {
    const router = new AnalyzerRouter({
      registry: {},
      primary: 'doubao'
    });
    await assert.rejects(router.route({}), /video.url is required/);
  });
});

describe('AnalyzerRouter.classify — error matrix', () => {
  test('AnalyzerUnavailableError → skip', () => {
    const r = AnalyzerRouter.classify(new AnalyzerUnavailableError('x', 'y'));
    assert.equal(r.action, 'skip');
  });

  test('NotLoggedInError → skip', () => {
    const r = AnalyzerRouter.classify(new NotLoggedInError('x', 'y'));
    assert.equal(r.action, 'skip');
  });

  test('code=UNAVAILABLE → skip', () => {
    const e = new Error('x'); e.code = 'UNAVAILABLE';
    assert.equal(AnalyzerRouter.classify(e).action, 'skip');
  });

  test('code=NOT_LOGGED_IN → skip', () => {
    const e = new Error('x'); e.code = 'NOT_LOGGED_IN';
    assert.equal(AnalyzerRouter.classify(e).action, 'skip');
  });

  test('code=CAPTCHA_DETECTED → abort', () => {
    const e = new Error('x'); e.code = 'CAPTCHA_DETECTED';
    assert.equal(AnalyzerRouter.classify(e).action, 'abort');
  });

  test('generic Error → fallback', () => {
    assert.equal(AnalyzerRouter.classify(new Error('network')).action, 'fallback');
  });

  test('null error → fallback', () => {
    assert.equal(AnalyzerRouter.classify(null).action, 'fallback');
  });
});

describe('AnalyzerRouter.route — placeholders integration', () => {
  test('real placeholder analyzer (kimi.mjs) throws UNAVAILABLE, router skips', async () => {
    // Import the real placeholder to verify integration
    const { KimiAnalyzer } = await import('../analyzers/kimi.mjs');
    const doubaoStub = makeStub({ name: 'doubao', behavior: 'success', result: { analysis: 'doubao ok' } });

    const router = new AnalyzerRouter({
      registry: { doubao: doubaoStub, kimi: KimiAnalyzer },
      primary: 'kimi',  // user explicitly chose kimi (placeholder) as primary
      fallback: ['doubao']
    });

    const result = await router.route({ url: 'https://test/v1', title: 't' });
    assert.equal(result.analysis, 'doubao ok');
    assert.equal(doubaoStub.callCount, 1);
  });
});