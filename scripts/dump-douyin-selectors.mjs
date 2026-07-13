#!/usr/bin/env node
/**
 * scripts/dump-douyin-selectors.mjs — 全自动版本
 *
 * 我亲自执行:
 *   1. 连接已启动的 Edge (9222)
 *   2. 打开抖音主页
 *   3. 检测登录态 (URL 有 /login → 未登录)
 *   4. 未登录 → 截图让你扫码 + 等待登录态变化
 *   5. 登录后自动跳收藏夹
 *   6. 抓 DOM 写 JSON
 *
 * 你唯一要做的事: 看到"请扫码登录"提示时, 在 Edge 里扫码。
 * 之后全流程我自动跑完。
 */

import { writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);

const CDP_PORT = 9222;
const FAVORITES_URL = 'https://www.douyin.com/user/self?showTab=favorite_collection';
const FALLBACK_URLS = [
  'https://www.douyin.com/user/self?showTab=favorite_collection',
  'https://www.douyin.com/user/self?showTab=favorite_post',
  'https://www.douyin.com/'
];
const LOAD_WAIT_MS = 3000;
const SCROLL_TIMES = 5;
const SCROLL_INTERVAL_MS = 1500;
const LOGIN_TIMEOUT_MS = 180000; // 3 分钟扫码超时

const SNAPSHOT_DIR = resolve('research/snapshots');

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function snapshot(page, label) {
  if (!await fileExists(SNAPSHOT_DIR)) {
    await mkdir(SNAPSHOT_DIR, { recursive: true });
  }
  const path = join(SNAPSHOT_DIR, `${label}.png`);
  try {
    await page.screenshot({ path, fullPage: false });
    console.error(`[dump] 📸 ${label} → ${path}`);
    return path;
  } catch (e) {
    console.error(`[dump] ⚠️  截图失败 ${label}: ${e.message}`);
    return null;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function checkCDP(port) {
  try {
    const res = await fetch(`http://localhost:${port}/json/version`);
    return res.ok;
  } catch { return false; }
}

async function main() {
  console.error('[dump] 加载 Playwright...');
  let chromium;
  try {
    chromium = require('playwright-core').chromium;
  } catch (e) {
    console.error('[dump] ❌ playwright-core 未安装。运行 npm install。');
    process.exit(1);
  }

  if (!await checkCDP(CDP_PORT)) {
    console.error(`[dump] ❌ 9222 端口无响应。先跑 launch-edge.mjs 启动 Edge。`);
    process.exit(1);
  }
  console.error(`[dump] ✅ 连接 9222 端口...`);

  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];
  if (!page) page = await ctx.newPage();

  try {
    console.error(`[dump] 当前 URL: ${page.url() || '(空白)'}`);
    console.error(`[dump] 打开抖音主页...`);
    await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);

    await snapshot(page, '01-douyin-home');

    // ---- 检测登录态 (DOM 真实登录态，不是 URL) ----
    let currentUrl = page.url();
    // 抖音页面有「登录」按钮表示未登录；已登录会显示用户名/头像
    const loginStatus = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button, a, span, div')];
      const hasLoginBtn = buttons.some(el => {
        const t = (el.textContent || '').trim();
        return t === '登录' || t === '登 录' || t.includes('立即登录');
      });
      const hasAvatar = !!document.querySelector('[class*="avatar"], [class*="Avatar"], img[src*="avatar"], [data-e2e*="avatar"]');
      const hasUsername = !!document.querySelector('[class*="user-name"], [class*="UserInfo"], [class*="user_info"]');
      return { hasLoginBtn, hasAvatar, hasUsername, isLoggedIn: !hasLoginBtn && (hasAvatar || hasUsername) };
    });

    console.error(`[dump] 登录态检测:`, JSON.stringify(loginStatus));

    let isLoggedIn = loginStatus.isLoggedIn;
    if (!isLoggedIn && !currentUrl.includes('/login') && !currentUrl.includes('passport.')) {
      // URL 没在登录页，但 DOM 显示「登录」按钮 — 强制刷新一下，可能 SPA 路由问题
      console.error(`[dump] URL 不在登录页但 DOM 显示未登录，可能是 SPA 路由未刷新`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(3000);
      await snapshot(page, '01b-after-reload');
      const recheck = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button, a, span, div')];
        const hasLoginBtn = buttons.some(el => {
          const t = (el.textContent || '').trim();
          return t === '登录' || t === '登 录' || t.includes('立即登录');
        });
        return { hasLoginBtn, isLoggedIn: !hasLoginBtn };
      });
      console.error(`[dump] 刷新后:`, JSON.stringify(recheck));
      isLoggedIn = recheck.isLoggedIn;
    }

    if (!isLoggedIn) {
      console.error('');
      console.error('[dump] ════════════════════════════════════════════════════════');
      console.error('[dump] ⚠️  检测到未登录');
      console.error('[dump] 📱 请在 Edge 里扫码登录抖音');
      console.error(`[dump] ⏳ 等待登录完成 (超时 ${LOGIN_TIMEOUT_MS / 1000}s)...`);
      console.error('[dump] ════════════════════════════════════════════════════════');
      console.error('');
      await snapshot(page, '02-login-required');

      // 等待 URL 变化（登录成功会跳转走）
      try {
        await page.waitForURL(
          url => {
            const u = url.toString();
            return !u.includes('/login') && !u.includes('passport.');
          },
          { timeout: LOGIN_TIMEOUT_MS, waitUntil: 'domcontentloaded' }
        );
        console.error('[dump] ✅ 检测到登录态变化');
      } catch (e) {
        console.error('[dump] ❌ 登录超时');
        await snapshot(page, '03-login-timeout');
        process.exit(1);
      }

      // 登录后再等几秒让页面渲染完
      await sleep(3000);
      await snapshot(page, '04-after-login');
    } else {
      console.error(`[dump] ✅ 已登录 (URL: ${currentUrl})`);
    }

    // ---- 进收藏夹 ----
    console.error('');
    console.error('[dump] 尝试进入收藏夹...');
    let foundFavorites = false;

    for (const url of FALLBACK_URLS) {
      console.error(`[dump] 尝试 URL: ${url}`);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(3000);
      } catch (e) {
        console.error(`[dump]   navigate 失败: ${e.message}`);
        continue;
      }

      // 检测是否有视频链接
      const videoCount = await page.evaluate(() =>
        document.querySelectorAll('a[href*="/video/"]').length
      );
      const pageTitle = await page.title();
      const finalUrl = page.url();
      console.error(`[dump]   URL: ${finalUrl}`);
      console.error(`[dump]   title: ${pageTitle}`);
      console.error(`[dump]   视频链接数: ${videoCount}`);

      await snapshot(page, `05-favorites-${videoCount}-videos`);

      if (videoCount > 0) {
        foundFavorites = true;
        console.error(`[dump] ✅ 找到收藏夹 (${videoCount} 个视频)`);
        break;
      }
    }

    if (!foundFavorites) {
      console.error('');
      console.error('[dump] ⚠️  多个 URL 都没找到视频，可能收藏夹入口不同');
      console.error('[dump] 请在 Edge 里手动: 点「我的收藏」/「收藏」 tab');
      console.error('[dump] 看到视频列表后按回车继续...');

      // 等待用户回车
      await new Promise(resolve => {
        process.stderr.write('[dump] 按回车继续 (或 Ctrl+C 取消)... ');
        process.stdin.setEncoding('utf-8');
        process.stdin.once('data', () => {
          process.stdin.pause();
          resolve();
        });
        process.stdin.resume();
      });

      const videoCount = await page.evaluate(() =>
        document.querySelectorAll('a[href*="/video/"]').length
      );
      if (videoCount === 0) {
        console.error('[dump] ❌ 仍然没找到视频，退出');
        await snapshot(page, '06-no-videos-found');
        process.exit(1);
      }
      console.error(`[dump] ✅ 找到 ${videoCount} 个视频`);
    }

    await sleep(LOAD_WAIT_MS);

    // ---- 滚动触发瀑布流懒加载 ----
    console.error('');
    console.error(`[dump] 滚动 ${SCROLL_TIMES} 次触发懒加载...`);
    for (let i = 0; i < SCROLL_TIMES; i++) {
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
      await sleep(SCROLL_INTERVAL_MS);
      const count = await page.evaluate(() =>
        document.querySelectorAll('a[href*="/video/"]').length
      );
      console.error(`[dump]   第 ${i + 1}/${SCROLL_TIMES} 次: ${count} 个视频`);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await sleep(1500);

    await snapshot(page, '07-after-scroll');

    // ---- 抓 data-e2e ----
    console.error('[dump] 抓取 [data-e2e] 属性...');
    const dataE2E = await page.evaluate(() => {
      const out = new Set();
      document.querySelectorAll('*').forEach(el => {
        for (const attr of el.attributes) {
          if (attr.name.startsWith('data-e2e')) {
            out.add(`${attr.name}="${attr.value}"`);
          }
        }
      });
      return [...out].sort();
    });

    // ---- 抓 CSS class ----
    console.error('[dump] 抓取常用 CSS class...');
    const keyClasses = await page.evaluate(() => {
      const counter = {};
      document.querySelectorAll('*').forEach(el => {
        for (const cls of el.classList) {
          counter[cls] = (counter[cls] || 0) + 1;
        }
      });
      return Object.entries(counter)
        .filter(([, n]) => n >= 3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {});
    });

    // ---- Baseline check ----
    console.error('[dump] Baseline check: 验证 videomind 现有 selector...');
    const BASELINE_SELECTORS = {
      'userFavoritesTab': '[data-e2e="user-favorites"]',
      'collectionCard': '.favorites-collection-card',
      'videoCard': '.video-card',
      'videoTitle': '.title',
      'videoAuthor': '.author',
      'commentItem': '.comment-item',
      'commentItemE2E': '[data-e2e="comment-item"]',
      'commentText': '.comment-text',
      'commentAuthor': '.comment-author',
      'anyVideoLink': 'a[href*="/video/"]'
    };

    const baselineCheck = {};
    const brokenSelectors = [];
    for (const [name, selector] of Object.entries(BASELINE_SELECTORS)) {
      try {
        const count = await page.locator(selector).count();
        baselineCheck[name] = { selector, exists: count > 0, count };
        const status = count > 0 ? '✅' : '❌';
        console.error(`[dump]   ${status} ${name.padEnd(20)} ${selector.padEnd(45)} (${count})`);
        if (count === 0) brokenSelectors.push(name);
      } catch (e) {
        baselineCheck[name] = { selector, exists: false, count: 0, error: e.message };
        brokenSelectors.push(name);
      }
    }

    // ---- 抓视频卡片样本 ----
    console.error(`[dump] 抓取视频卡片样本...`);
    const videoCardSamples = await page.evaluate(() => {
      const candidates = [];
      document.querySelectorAll('[data-e2e]').forEach(el => {
        const attrs = {};
        for (const a of el.attributes) {
          if (a.name.startsWith('data-e2e')) attrs[a.name] = a.value;
        }
        const isVideo = Object.keys(attrs).some(k =>
          k.includes('video') || k.includes('Video') ||
          (attrs[k] && (attrs[k].includes('video') || attrs[k].includes('Video')))
        );
        if (isVideo) {
          candidates.push({ el, attrs, html: el.outerHTML.slice(0, 2000) });
        }
      });

      if (candidates.length === 0) {
        document.querySelectorAll('a[href*="/video/"]').forEach(a => {
          const card = a.closest('div[class]') || a.parentElement;
          if (card) {
            candidates.push({
              el: card,
              attrs: Object.fromEntries(
                [...card.attributes].filter(a => a.name.startsWith('data-e2e'))
                  .map(a => [a.name, a.value])
              ),
              html: card.outerHTML.slice(0, 2000)
            });
          }
        });
      }

      const seen = new WeakSet();
      const unique = candidates.filter(c => {
        if (seen.has(c.el)) return false;
        seen.add(c.el);
        return true;
      });

      return unique.slice(0, 20).map((c, i) => ({
        index: i,
        dataE2E: c.attrs,
        outerHTMLPreview: c.html,
        outerHTMLLength: c.el.outerHTML.length
      }));
    });

    // ---- DOM 结构快照 ----
    const domSnapshot = await page.evaluate(() => {
      return {
        bodyChildCount: document.body.children.length,
        rootImmediate: [...document.body.children].map(c => ({
          tag: c.tagName.toLowerCase(),
          id: c.id || null,
          className: c.className || null
        })),
        mainContainerCandidates: [...document.querySelectorAll('main, [role="main"], #root > div')]
          .slice(0, 5)
          .map(el => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') +
            (el.className ? `.${el.className.split(' ').join('.')}` : ''))
      };
    });

    // ---- 输出 ----
    const result = {
      capturedAt: new Date().toISOString(),
      cdpPort: CDP_PORT,
      pageUrl: page.url(),
      pageTitle: await page.title(),
      baselineCheck,
      baselineBroken: brokenSelectors,
      dataE2E,
      dataE2ECount: dataE2E.length,
      keyClasses,
      videoCardSamples,
      videoCardSampleCount: videoCardSamples.length,
      domSnapshot,
      snapshots: [
        'research/snapshots/01-douyin-home.png',
        'research/snapshots/02-login-required.png (if needed)',
        'research/snapshots/04-after-login.png (if needed)',
        'research/snapshots/05-favorites-*-videos.png',
        'research/snapshots/07-after-scroll.png'
      ],
      notes: [
        'baselineBroken 列出 videomind 当前 douyin.mjs 中失效的 selector。',
        'dataE2E 是所有 [data-e2e] 属性集合。',
        'videoCardSamples 是瀑布流视频卡片的 outerHTML 样本 (前 2000 字符)。',
        '把此 JSON 给 AI 整理为 selectors/douyin.json。'
      ]
    };

    const json = JSON.stringify(result, null, 2);
    const outPath = resolve('research/douyin-selectors-raw.json');
    await writeFile(outPath, json, 'utf-8');

    console.error('');
    console.error('[dump] ════════════════════════════════════════════════════════');
    console.error(`[dump] ✅ 完成! 写入 ${outPath}`);
    console.error(`[dump]    data-e2e 数量: ${result.dataE2ECount}`);
    console.error(`[dump]    视频卡片样本: ${result.videoCardSampleCount}`);
    console.error(`[dump]    CSS class 数: ${Object.keys(result.keyClasses).length}`);
    console.error(`[dump]    Baseline 失效: ${brokenSelectors.length} 个 (${brokenSelectors.join(', ') || '无'})`);
    console.error(`[dump]    截图: ${SNAPSHOT_DIR}`);
    console.error('[dump] ════════════════════════════════════════════════════════');

  } catch (e) {
    console.error('[dump] ❌ 失败:', e.message);
    if (process.env.DEBUG) console.error(e.stack);
    if (page) await snapshot(page, '99-error');
    process.exit(1);
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}  // connectOverCDP 的 close 不会杀 Edge
    }
  }
}

main().catch(e => {
  console.error('[dump] 未捕获异常:', e);
  process.exit(1);
});