#!/usr/bin/env node
/**
 * scripts/dump-kimi-send-button.mjs — Kimi 发送按钮专用 dump
 *
 * 第一次 dump 没找到 send button（关键词 send/发送/submit 都不匹配 — Kimi 是箭头图标按钮）
 * 这个脚本专门找：
 *   1. 所有 icon-button / linear-icon-button 类
 *   2. 所有含 SVG 箭头的 button
 *   3. chat-input-editor 的兄弟元素（发送按钮通常在 input 旁边）
 */

import { writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const CDP_PORT = 9222;
const KIMI_URL = 'https://kimi.com';
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
  } catch (e) { return null; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function checkCDP(port) {
  try { const res = await fetch(`http://localhost:${port}/json/version`); return res.ok; }
  catch { return false; }
}

async function main() {
  const chromium = require('playwright-core').chromium;
  if (!await checkCDP(CDP_PORT)) {
    console.error('[dump] ❌ 9222 无响应');
    process.exit(1);
  }

  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];
  if (!page) page = await ctx.newPage();

  try {
    await page.goto(KIMI_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // ---- 找 input 的兄弟元素（最可能是发送按钮容器） ----
    const inputSiblings = await page.evaluate(() => {
      const input = document.querySelector('div.chat-input-editor[contenteditable="true"]');
      if (!input) return null;

      // 向上找父链，每层都列出兄弟
      const result = [];
      let current = input;
      for (let depth = 0; depth < 5; depth++) {
        const parent = current.parentElement;
        if (!parent) break;
        const siblings = [...parent.children].map((el, i) => {
          const className = (typeof el.className === 'string' ? el.className : (el.className?.baseVal || '')) || '';
          return {
            index: i,
            tag: el.tagName.toLowerCase(),
            className: className.slice(0, 200),
            textContent: (el.textContent || '').trim().slice(0, 100),
            outerHTMLPreview: el.outerHTML.slice(0, 500)
          };
        });
        result.push({ depth, parentTag: parent.tagName.toLowerCase(), parentClass: (parent.className?.toString?.() || '').slice(0, 200), siblings });
        current = parent;
      }
      return result;
    });

    // ---- 找所有可能的发送按钮（含 icon / svg / arrow / ↑） ----
    const sendCandidates = await page.evaluate(() => {
      const out = [];
      // 1. 所有 button + 含 svg 的 button
      document.querySelectorAll('button').forEach((el, i) => {
        const className = (typeof el.className === 'string' ? el.className : (el.className?.baseVal || '')) || '';
        const hasSvg = el.querySelector('svg') !== null;
        const ariaLabel = (el.getAttribute('aria-label') || '').trim();
        if (hasSvg || ariaLabel || className.includes('button') || className.includes('send') || className.includes('icon')) {
          out.push({
            type: 'button-with-svg-or-label',
            tag: 'button',
            className: className.slice(0, 200),
            ariaLabel,
            hasSvg,
            textContent: (el.textContent || '').trim().slice(0, 50),
            outerHTMLPreview: el.outerHTML.slice(0, 600)
          });
        }
      });

      // 2. 所有 .linear-icon-button
      document.querySelectorAll('.linear-icon-button, .icon-button').forEach((el) => {
        const className = (typeof el.className === 'string' ? el.className : (el.className?.baseVal || '')) || '';
        out.push({
          type: 'icon-button-class',
          tag: el.tagName.toLowerCase(),
          className: className.slice(0, 200),
          ariaLabel: el.getAttribute('aria-label') || '',
          textContent: (el.textContent || '').trim().slice(0, 50),
          outerHTMLPreview: el.outerHTML.slice(0, 600)
        });
      });

      return out;
    });

    // ---- 找所有 SVG 含箭头的 button（↑） ----
    const arrowButtons = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('button, [role="button"]').forEach((el) => {
        const svg = el.querySelector('svg');
        if (!svg) return;
        const svgClass = (typeof svg.className === 'string' ? svg.className : (svg.className?.baseVal || '')) || '';
        // 找有箭头图标特征的 svg
        const path = svg.querySelector('path');
        const pathD = path ? path.getAttribute('d') : '';
        const isArrow = /arrow|up|forward|submit/i.test(svgClass) ||
                        /[Mm]\d+\s+\d+[\s,]*[Ll]\d+\s+\d+/i.test(pathD);  // 简单路径检测
        if (isArrow || svgClass.includes('icon') || svgClass.includes('arrow')) {
          out.push({
            parentClass: (typeof el.className === 'string' ? el.className : (el.className?.baseVal || '')) || '',
            svgClass: svgClass.slice(0, 200),
            svgOuterHTMLPreview: svg.outerHTML.slice(0, 300),
            buttonOuterHTMLPreview: el.outerHTML.slice(0, 500)
          });
        }
      });
      return out;
    });

    // ---- 找聊天区域的结构（用于 response selector） ----
    const chatStructure = await page.evaluate(() => {
      const input = document.querySelector('div.chat-input-editor[contenteditable="true"]');
      if (!input) return null;

      // 找 chat-input-editor 的容器，往上找 message-list
      let current = input;
      const ancestors = [];
      for (let i = 0; i < 10; i++) {
        const parent = current.parentElement;
        if (!parent) break;
        const className = (typeof parent.className === 'string' ? parent.className : (parent.className?.baseVal || '')) || '';
        ancestors.push({
          tag: parent.tagName.toLowerCase(),
          className: className.slice(0, 200),
          childCount: parent.children.length
        });
        if (className.includes('message-list') || className.includes('chat-container')) {
          break;
        }
        current = parent;
      }
      return ancestors;
    });

    // ---- 触发实际 input 看 send button 变化 ----
    console.error('[dump] 输入测试文本看 send button 变化...');
    await page.evaluate(() => {
      const input = document.querySelector('div.chat-input-editor[contenteditable="true"]');
      if (input) {
        input.focus();
        input.textContent = 'test';
        input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }
    });
    await sleep(2000);
    await snapshot(page, 'kimi-06-after-input');

    // 重新抓按钮（输入文本后通常会激活）
    const sendCandidatesAfterInput = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('button').forEach((el, i) => {
        const className = (typeof el.className === 'string' ? el.className : (el.className?.baseVal || '')) || '';
        const disabled = el.disabled || el.getAttribute('disabled') !== null;
        const hasSvg = el.querySelector('svg') !== null;
        const isLikelySend = hasSvg && (
          className.includes('send') ||
          className.includes('submit') ||
          className.includes('enter') ||
          /[↑→➤▶]/.test(el.textContent || '')
        );
        if (isLikelySend || (hasSvg && !disabled && i < 30)) {
          out.push({
            className: className.slice(0, 200),
            disabled,
            hasSvg,
            ariaLabel: el.getAttribute('aria-label') || '',
            textContent: (el.textContent || '').trim().slice(0, 50),
            outerHTMLPreview: el.outerHTML.slice(0, 600)
          });
        }
      });
      return out;
    });

    // ---- 输出 ----
    const result = {
      capturedAt: new Date().toISOString(),
      cdpPort: CDP_PORT,
      pageUrl: page.url(),
      pageTitle: await page.title(),
      inputSiblings,
      sendCandidates,
      arrowButtons,
      chatStructure,
      sendCandidatesAfterInput,
      notes: [
        'inputSiblings: chat-input-editor 向上 5 层的兄弟元素（含父 class）',
        'sendCandidates: 所有 button + 关键词 icon/send/aria-label 命中的',
        'arrowButtons: 含 svg 且 svg class 有 arrow/icon 的 button',
        'sendCandidatesAfterInput: 输入测试文本后激活的按钮（disabled 状态变化）'
      ]
    };

    const json = JSON.stringify(result, null, 2);
    const outPath = resolve('research/kimi-send-button.json');
    await writeFile(outPath, json, 'utf-8');

    console.error('');
    console.error(`[dump] ✅ 写入 ${outPath}`);
    console.error(`[dump]    inputSiblings 深度: ${inputSiblings?.length || 0}`);
    console.error(`[dump]    sendCandidates: ${sendCandidates.length}`);
    console.error(`[dump]    arrowButtons: ${arrowButtons.length}`);
    console.error(`[dump]    sendCandidatesAfterInput: ${sendCandidatesAfterInput.length}`);
    console.error(`[dump]    chatStructure ancestors: ${chatStructure?.length || 0}`);

  } catch (e) {
    console.error('[dump] ❌ 失败:', e.message);
    if (process.env.DEBUG) console.error(e.stack);
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}

main().catch(e => { console.error(e); process.exit(1); });