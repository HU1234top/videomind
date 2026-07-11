/**
 * src/core/dom-watcher.mjs — 智能等待 DOM 文本稳定
 *
 * 替代硬编码 page.waitForTimeout(30000) + stop button selector 检测。
 * 原理: 监听 document.body.innerText 末尾 N 字符，连续 K 次不变 = 渲染完成。
 *
 * WorkBuddy batch_doubao_v5.mjs 的 waitForResponseComplete() 思路。
 */

/**
 * src/core/dom-watcher.mjs — 智能等待 DOM 文本稳定
 *
 * 替代硬编码 page.waitForTimeout(30000) + stop button selector 检测。
 * 原理: 监听 document.body.innerText 末尾 N 字符，连续 K 次不变 = 渲染完成。
 *
 * WorkBuddy batch_doubao_v5.mjs 的 waitForResponseComplete() 思路。
 */

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const DEFAULT_TAIL_LENGTH = 2000;     // 末尾比较字符数
const DEFAULT_POLL_INTERVAL_MS = 8000; // 轮询间隔 (跟 WorkBuddy 一致)
const DEFAULT_STABLE_COUNT = 3;       // 连续多少次不变 = 完成
const DEFAULT_MAX_WAIT_MS = 600000;   // 最大等待 10 分钟

/**
 * 等待 body innerText 末尾稳定 (3 次连续不变 = 完成)
 *
 * @param {import('playwright').Page} page
 * @param {Object} options
 * @param {number} options.tailLength - 末尾比较字符数 (默认 2000)
 * @param {number} options.pollIntervalMs - 轮询间隔 (默认 8000)
 * @param {number} options.stableCount - 连续不变次数 (默认 3 = 24s)
 * @param {number} options.maxWaitMs - 最大等待 (默认 600000 = 10min)
 * @param {Function} options.onCheck - 每次检查回调 (用于 captcha 检测)
 * @returns {Promise<string>} 最终稳定的 innerText
 */
export async function waitForBodyTextStable(page, options = {}) {
  const {
    tailLength = DEFAULT_TAIL_LENGTH,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    stableCount = DEFAULT_STABLE_COUNT,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
    onCheck = null
  } = options;

  const start = Date.now();
  let lastTail = '';
  let stable = 0;

  while (Date.now() - start < maxWaitMs) {
    await sleep(pollIntervalMs);

    // 用户回调 (e.g. captcha 检测)
    if (onCheck) {
      const continueWaiting = await onCheck(page);
      if (continueWaiting === false) {
        throw new Error('onCheck returned false (user-defined abort)');
      }
    }

    const currentText = await page.evaluate(() => document.body.innerText);
    const tail = currentText.substring(currentText.length - tailLength);

    if (tail === lastTail && tail.length > 0) {
      stable++;
      if (stable >= stableCount) {
        return currentText;
      }
    } else {
      stable = 0;
      lastTail = tail;
    }
  }

  throw new Error(`waitForBodyTextStable timeout after ${maxWaitMs}ms (stableCount=${stable})`);
}

/**
 * 等待指定元素出现且文本稳定 (比 waitForBodyTextStable 更精确)
 *
 * @param {import('playwright').Page} page
 * @param {string} selector - 任意 selector
 * @param {Object} options - 同 waitForBodyTextStable
 * @returns {Promise<{element: any, text: string}>}
 */
export async function waitForElementTextStable(page, selector, options = {}) {
  const {
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    stableCount = DEFAULT_STABLE_COUNT,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
    tailLength = 500
  } = options;

  const start = Date.now();
  let lastTail = '';
  let stable = 0;
  let element = null;

  while (Date.now() - start < maxWaitMs) {
    await sleep(pollIntervalMs);

    try {
      element = await page.locator(selector).last();
      const text = await element.textContent().catch(() => '');
      const tail = (text || '').substring((text || '').length - tailLength);

      if (tail === lastTail && tail.length > 0) {
        stable++;
        if (stable >= stableCount) {
          return { element, text };
        }
      } else {
        stable = 0;
        lastTail = tail;
      }
    } catch {
      // element not found yet, keep waiting
    }
  }

  throw new Error(`waitForElementTextStable timeout for ${selector}`);
}

/**
 * 检测"响应是否开始"：prompt 文字后有 > threshold 字符 = AI 在生成中
 *
 * 用于多视频批量分析场景（WorkBuddy 验证过）：
 * 检测到 "请逐个分析以下抖音视频" + 后续 > 5000 字符 → 切换到"完成检测"模式
 *
 * @param {import('playwright').Page} page
 * @param {string} promptMarker - prompt 中的标志性文字
 * @param {number} threshold - 字符阈值 (默认 5000)
 * @returns {Promise<boolean>}
 */
export async function detectResponseStarted(page, promptMarker, threshold = 5000) {
  return page.evaluate(({ marker, th }) => {
    const text = document.body.innerText;
    const idx = text.indexOf(marker);
    if (idx < 0) return false;
    return text.substring(idx).length > th;
  }, { marker: promptMarker, th: threshold });
}