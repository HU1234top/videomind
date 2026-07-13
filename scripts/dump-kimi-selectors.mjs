#!/usr/bin/env node
/**
 * scripts/dump-kimi-selectors.mjs — Kimi (kimi.ai) selector dump
 *
 * Round 10 Kimi Analyzer 实现前置:
 *   1. 连接已启动的 Edge (9222)
 *   2. 打开 kimi.ai (Kimi 网页版无需登录, 主页即 chat)
 *   3. 探测 userLoggedInIndicator (仅供调试, 不影响流程)
 *   4. 抓 chat input / send button / response container 的 selector
 *   5. 抓 [data-e2e] / placeholder / 关键词 CSS class
 *   6. 写 research/kimi-selectors-raw.json
 *
 * 用法:
 *   1. node scripts/launch-edge.mjs 启动 Edge
 *   2. node scripts/dump-kimi-selectors.mjs 跑 dump
 *   3. 把 JSON 给 AI 整理为 selectors/kimi.json
 */

import { writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const CDP_PORT = 9222;
const KIMI_URL = 'https://kimi.ai';
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
    console.error(`[dump] 打开 kimi.ai...`);
    await page.goto(KIMI_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    await snapshot(page, 'kimi-01-home');

    // ---- 探测 userLoggedInIndicator (仅供调试, 不影响流程) ----
    console.error('[dump] 探测 userLoggedInIndicator (avatar / user / profile 类)...');
    const userLoggedInIndicator = await page.evaluate(() => {
      const avatarEls = [...document.querySelectorAll(
        '[class*="avatar" i], [class*="Avatar"], img[alt*="avatar" i], img[alt*="Avatar"]'
      )];
      const userEls = [...document.querySelectorAll(
        '[class*="user" i], [class*="User"], [class*="profile" i], [class*="Profile"]'
      )];
      return {
        avatarCount: avatarEls.length,
        userClassCount: userEls.length,
        avatarClasses: avatarEls.slice(0, 5).map(el => (el.className || el.tagName).toString().slice(0, 100)),
        userClasses: userEls.slice(0, 5).map(el => (el.className || el.tagName).toString().slice(0, 100)),
        firstAvatar: avatarEls[0] ? {
          tag: avatarEls[0].tagName.toLowerCase(),
          className: (avatarEls[0].className || '').toString().slice(0, 200),
          outerHTMLPreview: avatarEls[0].outerHTML.slice(0, 300)
        } : null,
        firstUserEl: userEls[0] ? {
          tag: userEls[0].tagName.toLowerCase(),
          className: (userEls[0].className || '').toString().slice(0, 200),
          outerHTMLPreview: userEls[0].outerHTML.slice(0, 300)
        } : null
      };
    });
    console.error(`[dump] userLoggedInIndicator: ${JSON.stringify(userLoggedInIndicator)}`);

    console.error('');
    console.error('[dump] ════════════════════════════════════════════════════════');
    console.error('[dump] === 抓 selector ===');
    console.error('[dump] ════════════════════════════════════════════════════════');

    // ---- 抓 [data-e2e] ----
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

    // ---- 抓 input 元素 ----
    console.error('[dump] 抓取输入元素...');
    const inputCandidates = await page.evaluate(() => {
      const out = [];
      // textarea / contenteditable
      document.querySelectorAll('textarea, [contenteditable="true"]').forEach((el, i) => {
        const attrs = {};
        for (const a of el.attributes) attrs[a.name] = a.value;
        out.push({
          tag: el.tagName.toLowerCase(),
          contenteditable: el.getAttribute('contenteditable'),
          placeholder: el.getAttribute('placeholder'),
          attrs,
          textPreview: (el.textContent || '').slice(0, 50),
          outerHTMLPreview: el.outerHTML.slice(0, 500)
        });
      });
      return out;
    });

    // ---- 抓 button 元素 ----
    console.error('[dump] 抓取按钮元素（关键词: send / 发送 / submit）...');
    const buttonCandidates = await page.evaluate(() => {
      const keywords = ['send', '发送', 'submit', '提交', 'arrow', 'paper'];
      const out = [];
      document.querySelectorAll('button, [role="button"]').forEach((el) => {
        const text = (el.textContent || '').trim();
        const ariaLabel = (el.getAttribute('aria-label') || '');
        const className = el.className || '';
        const match = keywords.some(k =>
          text.toLowerCase().includes(k.toLowerCase()) ||
          ariaLabel.toLowerCase().includes(k.toLowerCase()) ||
          className.toLowerCase().includes(k.toLowerCase())
        );
        if (match) {
          const attrs = {};
          for (const a of el.attributes) attrs[a.name] = a.value;
          out.push({
            tag: el.tagName.toLowerCase(),
            text: text.slice(0, 50),
            ariaLabel,
            className: (className || '').slice(0, 100),
            attrs,
            outerHTMLPreview: el.outerHTML.slice(0, 400)
          });
        }
      });
      return out;
    });

    // ---- 抓 response 容器（看起来像 message / answer / markdown） ----
    console.error('[dump] 抓取可能的 AI response 容器...');
    const responseCandidates = await page.evaluate(() => {
      const keywords = ['message', 'markdown', 'answer', 'response', 'assistant', 'bot', 'chat-content', 'chat-bubble'];
      const counter = {};
      document.querySelectorAll('*').forEach((el) => {
        // SVG elements have SVGAnimatedString for className, not a plain string
        const className = (typeof el.className === 'string' ? el.className : (el.className?.baseVal || '')) || '';
        for (const k of keywords) {
          if (className.toLowerCase().includes(k.toLowerCase())) {
            counter[className] = (counter[className] || 0) + 1;
          }
        }
      });
      return Object.entries(counter)
        .filter(([, n]) => n >= 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {});
    });

    // ---- 抓 CSS class ----
    console.error('[dump] 抓取常用 CSS class...');
    const keyClasses = await page.evaluate(() => {
      const counter = {};
      document.querySelectorAll('*').forEach(el => {
        // SVG classList also returns SVGAnimatedString-like; iterate via className.baseVal fallback
        const cls = (typeof el.classList !== 'undefined' && el.classList.length > 0)
          ? [...el.classList]
          : ((typeof el.className === 'string' ? el.className : (el.className?.baseVal || '')) || '').split(/\s+/).filter(Boolean);
        for (const c of cls) {
          counter[c] = (counter[c] || 0) + 1;
        }
      });
      return Object.entries(counter)
        .filter(([, n]) => n >= 3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {});
    });

    // ---- 抓 placeholder 属性 ----
    console.error('[dump] 抓取所有 placeholder...');
    const placeholders = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('[placeholder]').forEach(el => {
        out.push({
          tag: el.tagName.toLowerCase(),
          placeholder: el.getAttribute('placeholder'),
          className: el.className || ''
        });
      });
      return out;
    });

    // ---- DOM 结构快照 ----
    const domSnapshot = await page.evaluate(() => ({
      bodyChildCount: document.body.children.length,
      url: location.href,
      title: document.title
    }));

    // ---- 输出 ----
    const result = {
      capturedAt: new Date().toISOString(),
      cdpPort: CDP_PORT,
      pageUrl: page.url(),
      pageTitle: await page.title(),
      userLoggedInIndicator,
      domSnapshot,
      dataE2E,
      dataE2ECount: dataE2E.length,
      placeholders,
      inputCandidates,
      buttonCandidates,
      responseCandidates,
      keyClasses,
      snapshots: [
        'research/snapshots/kimi-01-home.png'
      ],
      notes: [
        'Kimi 网页版无需登录, 主页直接展示 chat input (placeholder="尽管问...") + 发送箭头按钮 + 模型选择器. ',
        'userLoggedInIndicator 仅供调试, 不影响主流程 (Kimi 无需登录也能 chat). ',
        'inputCandidates: 所有 textarea / contenteditable 的属性。',
        'buttonCandidates: 关键词匹配的按钮（send / 发送等）。',
        'responseCandidates: class 含 message/markdown/answer/response 等的 class 计数。',
        '把此 JSON 给 AI 整理为 selectors/kimi.json。',
        'Kimi 是 chat AI, 没有瀑布流; 只需 chat input / send button / response container 三类 selector。'
      ]
    };

    const json = JSON.stringify(result, null, 2);
    const outPath = resolve('research/kimi-selectors-raw.json');
    await writeFile(outPath, json, 'utf-8');

    console.error('');
    console.error('[dump] ════════════════════════════════════════════════════════');
    console.error(`[dump] ✅ 完成! 写入 ${outPath}`);
    console.error(`[dump]    data-e2e 数量: ${result.dataE2ECount}`);
    console.error(`[dump]    input candidates: ${inputCandidates.length}`);
    console.error(`[dump]    button candidates: ${buttonCandidates.length}`);
    console.error(`[dump]    response class 候选: ${Object.keys(responseCandidates).length}`);
    console.error(`[dump]    截图: ${SNAPSHOT_DIR}`);
    console.error('[dump] ════════════════════════════════════════════════════════');

  } catch (e) {
    console.error('[dump] ❌ 失败:', e.message);
    if (process.env.DEBUG) console.error(e.stack);
    if (page) await snapshot(page, 'kimi-99-error');
    process.exit(1);
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}  // connectOverCDP close 不杀 Edge
    }
  }
}

main().catch(e => {
  console.error('[dump] 未捕获异常:', e);
  process.exit(1);
});