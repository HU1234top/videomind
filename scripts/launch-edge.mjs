#!/usr/bin/env node
/**
 * scripts/launch-edge.mjs — 我亲自启动 Edge + 等登录态 + 跑 dump
 *
 * Round 12 修复：detached + unref 在 Windows 上不稳定，改用 nohup 等价（让节点退出
 * 时不杀掉子进程）。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9222;
const DEBUG_PROFILE = join(tmpdir(), 'videomind-edge-debug');

// 创建 debug profile 目录（隔离，跟你现有 Edge 不冲突）
if (!existsSync(DEBUG_PROFILE)) {
  mkdirSync(DEBUG_PROFILE, { recursive: true });
}

console.log('[launch-edge] 用户 debug profile:', DEBUG_PROFILE);

// Round 12 fix: 使用 detached + shell 启动，关键是不依赖 node 进程不退
// 在 Windows 上 `start ...` 让 Edge 脱离父进程
const cmd = `start "" "${EDGE_PATH}" --remote-debugging-port=${CDP_PORT} --remote-allow-origins=* --user-data-dir="${DEBUG_PROFILE}" "about:blank"`;
console.log('[launch-edge] 启动:', cmd);

const proc = spawn(cmd, {
  shell: true,
  stdio: 'ignore',
  windowsHide: false,
  detached: true  // 关键：让 Edge 跟 node 解耦
});

proc.on('error', err => {
  console.error('[launch-edge] ❌ 启动失败:', err.message);
  process.exit(1);
});
proc.unref();

console.log('[launch-edge] 等待 9222 端口响应...');

let attempts = 0;
const probe = setInterval(() => {
  attempts++;
  const req = http.get(`http://localhost:${CDP_PORT}/json/version`, res => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      if (res.statusCode === 200) {
        clearInterval(probe);
        try {
          const info = JSON.parse(body);
          console.log(`[launch-edge] ✅ Edge 已就绪 (用时 ${attempts}s)`);
          console.log(`[launch-edge] 浏览器: ${info.Browser}`);
          console.log(`[launch-edge] 接下来请手动登录任何需要的网站:`);
          console.log(`[launch-edge]   - 抖音（可选）`);
          console.log(`[launch-edge]   - Kimi（豆包/可灵等 Web AI）`);
          console.log(`[launch-edge]   - B 站（字幕采集）`);
        } catch (e) {
          console.error('[launch-edge] 解析响应失败:', e.message);
        }
      }
    });
  });
  req.on('error', () => {
    if (attempts >= 30) {
      clearInterval(probe);
      console.error('[launch-edge] ❌ 30s 内 Edge 未启动');
      process.exit(1);
    }
  });
  req.setTimeout(1000, () => req.destroy());
}, 1000);