#!/usr/bin/env node
/**
 * scripts/sync-cookies.mjs — 把用户日常 Edge 的 cookie 同步到 debug Edge profile
 *
 * Round 15 解决"每次跑分析都要重新登录"问题。
 *
 * 背景:
 *   - debug Edge (9222) 用专用 profile `%TEMP%/videomind-edge-debug`
 *   - 日常 Edge 用用户默认 profile，cookie 持久
 *   - 两者不共享 cookie → debug Edge 跑分析前必须手动登录每个网站
 *
 * 用法（推荐）:
 *   1. 右键 Edge 桌面图标 → 属性 → "目标" 加空格 `--remote-debugging-port=9223`
 *      (例如: "...msedge.exe" --remote-debugging-port=9223)
 *   2. 重启 Edge（产生 devtools CDN 9223 端口）
 *   3. 跑: `node scripts/sync-cookies.mjs`
 *   4. 然后 `node scripts/launch-edge.mjs`（debug Edge 自动复用 cookie）
 *
 * 实现:
 *   - 连 9223 (日常 Edge) → context.cookies() 拿所有 cookie
 *   - 连 9222 (debug Edge) → context.addCookies() 注入
 *   - 只注入一致域名（避免跨域污染）
 *   - 只覆盖 debug profile 没有的 cookie（保留用户手动 debug 登的）
 *
 * 局限:
 *   - 第一次需要你手动改 Edge 快捷方式（5 秒）
 *   - 每次跑分析前都要 sync（除非 Edge 一直开着）
 *   - HttpOnly cookie 是正常同步的（Chromium DevTools Protocol 支持）
 */

import { chromium } from 'playwright-core';

const DAILY_EDGE_PORT = parseInt(process.env.DAILY_EDGE_PORT || '9223', 10);
const DEBUG_EDGE_PORT = parseInt(process.env.DEBUG_EDGE_PORT || '9222', 10);

const TARGET_DOMAINS = [
  'doubao.com', '.doubao.com',
  'kimi.com', '.kimi.com',
  'douyin.com', '.douyin.com',
  'bilibili.com', '.bilibili.com'
];

function log(msg, data = null) {
  if (data) {
    console.log(`[sync-cookies] ${msg}`, data);
  } else {
    console.log(`[sync-cookies] ${msg}`);
  }
}

async function main() {
  // ===== Step 1: 检查 9223 (日常 Edge) 是否可达 =====
  let dailyBrowser = null;
  try {
    dailyBrowser = await chromium.connectOverCDP(`http://localhost:${DAILY_EDGE_PORT}`);
    log(`✅ 连上日常 Edge at :${DAILY_EDGE_PORT}`);
  } catch (e) {
    log(`❌ 连不上日常 Edge at :${DAILY_EDGE_PORT}`);
    log('需要你做一件事：');
    log('  1. 完全退出 Edge（关闭所有窗口）');
    log('  2. 右键 Edge 桌面图标 → 属性 → "目标" 后面加:');
    log(`     " --remote-debugging-port=${DAILY_EDGE_PORT}"`);
    log('  3. 重启 Edge（日常使用 + 9223 端口已开）');
    log('  4. 然后重跑: node scripts/sync-cookies.mjs');
    process.exit(1);
  }

  // ===== Step 2: 检查 9222 (debug Edge) 是否可达 =====
  let debugBrowser = null;
  try {
    debugBrowser = await chromium.connectOverCDP(`http://localhost:${DEBUG_EDGE_PORT}`);
    log(`✅ 连上 debug Edge at :${DEBUG_EDGE_PORT}`);
  } catch (e) {
    await dailyBrowser.close().catch(() => {});
    log(`❌ 连不上 debug Edge at :${DEBUG_EDGE_PORT}`);
    log('请先跑: node scripts/launch-edge.mjs');
    process.exit(1);
  }

  try {
    // ===== Step 3: 读日常 Edge 所有 cookie =====
    const dailyContext = dailyBrowser.contexts()[0];
    if (!dailyContext) {
      throw new Error('日常 Edge 没有 BrowserContext');
    }
    const dailyCookies = await dailyContext.cookies();
    log(`日常 Edge 有 ${dailyCookies.length} 个 cookie`);

    // ===== Step 4: 过滤到目标域名 =====
    const filtered = dailyCookies.filter(c =>
      TARGET_DOMAINS.some(d => c.domain.endsWith(d) || c.domain === d)
    );
    log(`匹配目标域名 (doubao/kimi/douyin/bilibili): ${filtered.length} 个`);

    if (filtered.length === 0) {
      log('⚠️  没找到目标域名的 cookie');
      log('可能: 你的日常 Edge 未登录抖音/Kimi/豆包/B 站');
      return;
    }

    // 按域名分组展示（方便排查）
    const byDomain = {};
    for (const c of filtered) {
      byDomain[c.domain] = (byDomain[c.domain] || 0) + 1;
    }
    log('域名分布:', byDomain);

    // ===== Step 5: 注入到 debug Edge =====
    const debugContext = debugBrowser.contexts()[0];
    if (!debugContext) {
      throw new Error('debug Edge 没有 BrowserContext');
    }

    // 看 debug Edge 现有 cookie（避免覆盖）
    const debugCookies = await debugContext.cookies();
    const debugCookieMap = new Map();
    for (const c of debugCookies) {
      debugCookieMap.set(`${c.domain}|${c.name}`, c);
    }

    // 计算真要注入的（debug 没有的 OR debug 已过期）
    const toAdd = [];
    let skipped = 0;
    for (const c of filtered) {
      const key = `${c.domain}|${c.name}`;
      const existing = debugCookieMap.get(key);
      if (existing && existing.value === c.value) {
        skipped++;
        continue;  // 同步、跳过
      }
      // Chromium DevTools Protocol 的 addCookies 不需要 expires/path/sameSite
      toAdd.push({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        expires: c.expires || -1,
        httpOnly: c.httpOnly || false,
        secure: c.secure || false,
        sameSite: c.sameSite || 'Lax'
      });
    }

    log(`新增/更新 ${toAdd.length} 个 cookie, 跳过（已相同）${skipped} 个`);

    if (toAdd.length === 0) {
      log('✅ debug Edge cookie 已是最新');
      return;
    }

    // 用 Promise.all 批量注入（Chromium 单次 addCookies 是单条）
    let success = 0;
    let failed = 0;
    await Promise.all(toAdd.map(async (cookie) => {
      try {
        await debugContext.addCookies([cookie]);
        success++;
      } catch (e) {
        failed++;
        log(`  ⚠️ 注入失败 ${cookie.name}@${cookie.domain}: ${e.message.slice(0, 80)}`);
      }
    }));

    log(`注入完成: 成功 ${success}, 失败 ${failed}`);

    // ===== Step 6: 验证 =====
    const afterCount = (await debugContext.cookies()).length;
    log(`debug Edge 当前 cookie 数: ${afterCount}`);
    log('');
    log('✅ 同步完成！');
    log('');
    log('下一步: 跑分析');
    log('  node src/cli.mjs analyze --analyzer doubao --no-checkpoint');
    log('  或');
    log('  node src/cli.mjs analyze --analyzer kimi --no-checkpoint');

  } finally {
    // 不关任何 Edge（用户日常 / debug 都别动）
    if (dailyBrowser) await dailyBrowser.close().catch(() => {});
    if (debugBrowser) await debugBrowser.close().catch(() => {});
  }
}

main().catch(e => {
  console.error('[sync-cookies] ❌ FATAL:', e.message);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});