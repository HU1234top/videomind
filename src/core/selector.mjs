/**
 * src/core/selector.mjs — 配置化 selector 系统
 *
 * 解决两个核心问题:
 * 1. 平台改版后 selector 失效 — JSON 配置 + 备选链
 * 2. 元素懒加载未渲染 — waitFor + 重试 + 滚动触发
 *
 * 用法:
 *   import { loadSelectors, waitForElement, captureFailure } from './selector.mjs';
 *   const selectors = loadSelectors('douyin');  // 从 selectors/douyin.json
 *   const card = await waitForElement(page, selectors.videoCard);
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, readdir, stat, rm } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 默认重试间隔 (递增，跟 rate-limiter 风格一致)
const DEFAULT_INTERVALS = [2000, 4000, 6000];

/**
 * 加载某平台的 selector 配置
 * @param {string} platform - 'douyin' | 'bilibili' | 'youtube' | ...
 * @returns {Object} selector 配置对象 (含 metadata + selectors 字段)
 */
export function loadSelectors(platform) {
  const path = resolve(__dirname, '..', '..', 'selectors', `${platform}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw);
  // JSON 结构: { version, lastVerified, ..., selectors: { videoCard: {...}, ... } }
  // 直接返回整个对象 (含 metadata)，调用方用 .selectors.videoCard 访问
  return parsed;
}

/**
 * 把 selector 配置展开成 Playwright 可用的 selector 字符串
 * (支持 primary + fallback 数组)
 *
 * @param {Object} selectorConfig - 从 JSON 读到的 selector 配置项
 * @returns {string} Playwright selector 字符串
 */
export function resolveSelector(selectorConfig) {
  if (!selectorConfig) return null;
  if (typeof selectorConfig === 'string') return selectorConfig;
  return selectorConfig.primary;
}

/**
 * 把 selector 配置展开成备选链 (用于多 selector 尝试)
 *
 * @param {Object} selectorConfig - 从 JSON 读到的 selector 配置项
 * @returns {Array<string>} selector 字符串数组 (含 primary + fallback)
 */
export function selectorChain(selectorConfig) {
  if (!selectorConfig) return [];
  if (typeof selectorConfig === 'string') return [selectorConfig];
  const chain = [selectorConfig.primary];
  if (Array.isArray(selectorConfig.fallback)) {
    chain.push(...selectorConfig.fallback);
  }
  return chain;
}

/**
 * 等待元素出现 — 内置轮询 + 递增间隔 + 滚动触发
 *
 * @param {import('playwright').Page} page
 * @param {Object|string} selectorConfig - selector 配置项或 selector 字符串
 * @param {Object} options
 * @param {number[]} options.intervals - 递增间隔 (ms)
 * @param {boolean} options.scrollTrigger - 是否滚动触发懒加载
 * @param {number} options.maxScrolls - 最多滚动几次
 * @param {Object} options.logger - pino logger 实例
 * @returns {Promise<{element: any, selector: string, attempts: Array}>}
 */
export async function waitForElement(page, selectorConfig, options = {}) {
  const {
    intervals = DEFAULT_INTERVALS,
    scrollTrigger = true,
    maxScrolls = 3,
    logger = null
  } = options;

  const chain = typeof selectorConfig === 'string'
    ? [selectorConfig]
    : selectorChain(selectorConfig);

  const attempts = [];

  // 第一次先滚一下触发懒加载
  if (scrollTrigger && chain.length > 0) {
    try {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await sleep(500);
    } catch (e) {
      logger?.warn?.({ err: e.message }, 'scroll trigger failed');
    }
  }

  for (let i = 0; i < chain.length; i++) {
    const sel = chain[i];
    const interval = intervals[Math.min(i, intervals.length - 1)];

    try {
      const element = await page.waitForSelector(sel, {
        timeout: interval,
        state: 'attached'
      });
      attempts.push({ selector: sel, index: i, success: true, waited: interval });
      logger?.debug?.({ selector: sel, index: i }, 'selector matched');
      return { element, selector: sel, attempts };
    } catch (e) {
      attempts.push({ selector: sel, index: i, success: false, waited: interval, err: e.message });
      logger?.warn?.({ selector: sel, index: i, waited: interval }, 'selector timed out');
    }

    // 失败后尝试滚动一次
    if (scrollTrigger && i < maxScrolls) {
      try {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await sleep(500);
      } catch {}
    }
  }

  // 全部失败
  return { element: null, selector: null, attempts };
}

/**
 * 截图保存 (用于 debug)
 *
 * @param {import('playwright').Page} page
 * @param {string} label - 截图标签
 * @param {Object} options
 * @param {string} options.root - 截图根目录 (默认 logs/screenshots)
 * @param {Object} options.logger - pino logger
 * @returns {Promise<string|null>} 截图路径 (失败返回 null)
 */
export async function captureFailure(page, label, options = {}) {
  const {
    root = resolve(process.cwd(), 'logs', 'screenshots'),
    logger = null,
    keepLastNRuns = 3
  } = options;

  try {
    const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = resolve(root, `run_${runId}`);
    await mkdir(dir, { recursive: true });
    const file = resolve(dir, `${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    logger?.debug?.({ path: file }, 'screenshot captured');
    await cleanupOldRuns(root, keepLastNRuns);
    return file;
  } catch (e) {
    logger?.warn?.({ err: e.message, label }, 'screenshot failed, continuing');
    return null;
  }
}

/**
 * 清理旧截图，保留最近 N 次运行
 */
async function cleanupOldRuns(root, keepN) {
  try {
    const dirs = await readdir(root).catch(() => []);
    const runs = (await Promise.all(dirs.map(async d => {
      const s = await stat(resolve(root, d)).catch(() => null);
      return s ? { name: d, mtime: s.mtime } : null;
    }))).filter(Boolean).sort((a, b) => b.mtime - a.mtime);
    for (const old of runs.slice(keepN)) {
      await rm(resolve(root, old.name), { recursive: true }).catch(() => {});
    }
  } catch (e) {
    // 静默忽略
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}