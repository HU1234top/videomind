#!/usr/bin/env node
/**
 * scripts/dump-claude-selectors.mjs — Claude.ai Web Chat selector dump
 *
 * Round 16 Claude Analyzer 实证:
 *   1. 连接已启动的 Edge (9222)
 *   2. 打开 claude.ai/chat (用户必须已登录)
 *   3. 探测未登录态 (claude.ai 通常 redirect /login)
 *   4. 抓 chat input / send button / response container 的 selector
 *   5. 抓 [data-testid] / aria-label / class 等
 *   6. 写 research/claude-selectors-raw.json
 *   7. 写 selectors/claude.json 的 lastVerified 时间戳
 *
 * 用法:
 *   1. node scripts/launch-edge.mjs 启动 Edge
 *   2. 在 Edge 里手动登录 Claude.ai (一次性)
 *   3. node scripts/dump-claude-selectors.mjs 跑 dump
 *   4. 检查 selectors/claude.json lastVerified 被回填
 */

import { writeFile, mkdir, access, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const CDP_PORT = 9222;
const CLAUDE_URL = 'https://claude.ai/chat';
const SNAPSHOT_DIR = resolve('research/snapshots');
const OUTPUT_FILE = resolve('research/claude-selectors-raw.json');
const SELECTOR_FILE = resolve('selectors/claude.json');

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
    console.error(`[dump-claude] 📸 ${label} → ${path}`);
    return path;
  } catch (e) {
    console.error(`[dump-claude] ⚠️  截图失败 ${label}: ${e.message}`);
    return null;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function checkCDP(port) {
  try {
    const res = await fetch(`http://localhost:${port}/json/version`);
    return res.ok;
  } catch { return false; }
}

async function main() {
  console.error('[dump-claude] 加载 Playwright...');
  let chromium;
  try {
    chromium = require('playwright-core').chromium;
  } catch (e) {
    console.error('[dump-claude] ❌ playwright-core 未安装。运行 npm install。');
    process.exit(1);
  }

  if (!await checkCDP(CDP_PORT)) {
    console.error('[dump-claude] ❌ 9222 端口无响应。先跑 launch-edge.mjs 启动 Edge。');
    process.exit(1);
  }
  console.error(`[dump-claude] ✅ 连接 9222 端口...`);

  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];
  if (!page) page = await ctx.newPage();

  try {
    // 1. 跳到 Claude Chat
    console.error(`[dump-claude] 跳转 ${CLAUDE_URL}...`);
    await page.goto(CLAUDE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000); // 等 SPA 加载

    // 2. 探测是否登录
    const finalUrl = page.url();
    const loginRedirected = finalUrl.includes('/login') || finalUrl.includes('/sign-in');
    console.error(`[dump-claude] 最终 URL: ${finalUrl}`);
    console.error(`[dump-claude] 登录态: ${loginRedirected ? '❌ 未登录 (被 redirect)' : '✅ 已登录'}`);
    await snapshot(page, 'claude-after-goto');

    if (loginRedirected) {
      console.error(`[dump-claude] ⚠️  Claude.ai 未登录!`);
      console.error(`[dump-claude] 在 Edge 窗口手动登录 Claude.ai 后重跑此脚本。`);
      // 不退出 — 仍然 dump 当前 login 页的 selector (可能有相关线索)
    }

    // 3. 抓 chat input selector
    console.error('[dump-claude] 抓取 chat input...');
    const inputProbe = await page.evaluate(() => {
      const candidates = [];
      // ProseMirror contenteditable
      document.querySelectorAll('[contenteditable="true"]').forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (r.width < 50 || r.height < 10) return;
        candidates.push({
          tag: el.tagName.toLowerCase(),
          aria: el.getAttribute('aria-label') || null,
          role: el.getAttribute('role') || null,
          class: el.className?.toString?.() || null,
          placeholder: el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || null,
          testid: el.closest('[data-testid]')?.getAttribute('data-testid') || null,
          width: r.width,
          height: r.height,
        });
      });
      return candidates;
    });
    console.error(`[dump-claude] 找到 ${inputProbe.length} 个 contenteditable 输入框候选`);

    // 4. 抓 send button selector
    console.error('[dump-claude] 抓取 send button...');
    const sendBtnProbe = await page.evaluate(() => {
      const candidates = [];
      document.querySelectorAll('button, [role="button"]').forEach((el) => {
        const aria = el.getAttribute('aria-label') || '';
        const text = el.textContent?.trim() || '';
        if (aria.match(/send|发送|submit/i) || text.match(/send|发送|submit/i)) {
          candidates.push({
            tag: el.tagName.toLowerCase(),
            aria,
            text,
            class: el.className?.toString?.() || null,
            testid: el.closest('[data-testid]')?.getAttribute('data-testid') || null,
            disabled: el.disabled,
            type: el.getAttribute('type'),
          });
        }
      });
      return candidates;
    });
    console.error(`[dump-claude] 找到 ${sendBtnProbe.length} 个 send button 候选`);

    // 5. 抓 response container（最近一条 assistant 消息）
    console.error('[dump-claude] 抓取 message container...');
    const responseProbe = await page.evaluate(() => {
      const probe = {
        turns: [],
        allTestIds: [],
        allAuthor: [],
      };
      document.querySelectorAll('[data-testid="conversation-turn"], [data-author]').forEach((el, i) => {
        const testid = el.getAttribute('data-testid');
        const author = el.getAttribute('data-author');
        probe.turns.push({
          index: i,
          testid,
          author,
          class: el.className?.toString?.() || null,
          childTestIds: Array.from(el.querySelectorAll('[data-testid]'))
            .map(c => c.getAttribute('data-testid'))
            .slice(0, 5),
        });
        if (testid) probe.allTestIds.push(testid);
        if (author) probe.allAuthor.push(author);
      });
      return probe;
    });
    console.error(`[dump-claude] 找到 ${responseProbe.turns.length} 个 turn 候选`);

    // 6. 抓 user menu / avatar
    console.error('[dump-claude] 抓取 user menu...');
    const userMenuProbe = await page.evaluate(() => {
      const candidates = [];
      document.querySelectorAll('[data-testid*="user" i], [data-testid*="avatar" i], [aria-label*="User menu" i], button[aria-label*="user" i]').forEach(el => {
        candidates.push({
          tag: el.tagName.toLowerCase(),
          aria: el.getAttribute('aria-label'),
          testid: el.getAttribute('data-testid'),
          class: (el.className?.toString?.() || '').slice(0, 100),
        });
      });
      return candidates;
    });
    console.error(`[dump-claude] 找到 ${userMenuProbe.length} 个 user menu/avatar 候选`);

    // 7. 抓全 page 所有 [data-testid] 去重
    const allTestIds = await page.evaluate(() => {
      const s = new Set();
      document.querySelectorAll('[data-testid]').forEach(el => {
        const v = el.getAttribute('data-testid');
        if (v) s.add(v);
      });
      return Array.from(s);
    });

    await snapshot(page, 'claude-final');

    // 8. 整理输出
    const result = {
      timestamp: new Date().toISOString(),
      url: CLAUDE_URL,
      finalUrl,
      loginState: loginRedirected ? 'redirected-to-login' : 'logged-in',
      inputProbe,
      sendBtnProbe,
      responseProbe,
      userMenuProbe,
      allTestIds,
    };

    if (!await fileExists(resolve('research'))) {
      await mkdir(resolve('research'), { recursive: true });
    }
    await writeFile(OUTPUT_FILE, JSON.stringify(result, null, 2), 'utf8');
    console.error(`[dump-claude] ✅ raw dump → ${OUTPUT_FILE}`);

    // 9. 更新 selectors/claude.json 的 lastVerified 字段
    if (!loginRedirected) {
      try {
        const selContent = await readFile(SELECTOR_FILE, 'utf8');
        const selJson = JSON.parse(selContent);
        selJson.lastVerified = new Date().toISOString().slice(0, 10);
        selJson.verifiedOn = `Edge via CDP 9222 (dump-claude-selectors.mjs on ${new Date().toISOString()})`;
        await writeFile(SELECTOR_FILE, JSON.stringify(selJson, null, 2) + '\n', 'utf8');
        console.error(`[dump-claude] ✅ selectors/claude.json updated: lastVerified=${selJson.lastVerified}`);
      } catch (e) {
        console.error(`[dump-claude] ⚠️  无法更新 selectors/claude.json: ${e.message}`);
      }
    } else {
      console.error(`[dump-claude] ⚠️  未登录, 不更新 lastVerified — 请先登录 Claude.ai 后重跑`);
    }

    console.error('[dump-claude] 退出...');
  } catch (e) {
    console.error(`[dump-claude] ❌ FATAL: ${e.message}`);
    process.exit(1);
  } finally {
    // 不关 Edge — 不能调 browser.close()
  }
}

main();
