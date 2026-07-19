/**
 * VideoMind Core — Thumbnail Upload Helper (Round 22)
 *
 * 让 doubao / Kimi "看到"视频封面图. 抖音 URL 被反爬虫拦截, 但 CDN 缩略图
 * (douyinpic.com) 一般能下载. 缩略图 + 评论 + tags 一起喂给 AI, 让 AI
 * 至少能从封面图推断技能内容.
 *
 * 借鉴 backup/worktree-cu-2026-07-13 的 Round 11 实战实现.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';

const DEFAULT_CACHE_DIR = path.resolve(
  process.env.TEMP || process.env.TMPDIR || '/tmp',
  'videomind-thumb-cache'
);

/**
 * 下载视频缩略图到本地临时文件.
 *
 * 抖音 thumb URL 是签名 URL, 有效期 2-3 天, 过期后需要重新 collect.
 * 缓存策略: 按 videoId + thumbHash 命名, 跳过已下载.
 *
 * @param {Object} opts
 * @param {string} opts.thumbUrl - 来自 video_list.json 的 thumb 字段
 * @param {string} opts.videoUrl - 用于生成唯一缓存 key
 * @param {string} [opts.cacheDir] - 自定义缓存目录
 * @param {Object} [opts.logger]
 * @returns {Promise<string|null>} 本地文件路径; 失败返回 null (不抛)
 */
export async function downloadThumbnail({ thumbUrl, videoUrl, cacheDir, logger }) {
  if (!thumbUrl || typeof thumbUrl !== 'string') return null;

  const dir = cacheDir || DEFAULT_CACHE_DIR;
  await fs.mkdir(dir, { recursive: true });

  // 从 videoUrl 提取 videoId, 失败用 thumbHash
  const videoId = (videoUrl?.match(/video\/(\d+)/) || [, 'unknown'])[1];
  const cacheKey = crypto.createHash('md5').update(thumbUrl).digest('hex').slice(0, 8);
  const ext = (thumbUrl.match(/\.(jpg|jpeg|png|webp)/i) || [, '.jpg'])[1].toLowerCase();
  const filePath = path.join(dir, `${videoId}-${cacheKey}.${ext}`);

  // 已存在就跳过
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > 100) {
      logger?.debug?.({ stage: 'thumb', filePath, size: stat.size }, 'thumb cache hit');
      return filePath;
    }
  } catch { /* 不存在, 继续 */ }

  // 下载 (Node 原生 https/http)
  return new Promise((resolve) => {
    // URL 合法性快速校验 (避免 node:http.get 抛 TypeError Invalid URL)
    if (!/^https?:\/\//i.test(thumbUrl)) {
      logger?.warn?.({ stage: 'thumb', thumbUrl }, 'invalid URL protocol');
      return resolve(null);
    }

    const lib = thumbUrl.startsWith('https') ? https : http;

    const req = lib.get(thumbUrl, { headers: { 'User-Agent': 'videomind/1.0' } }, async (res) => {
      if (res.statusCode !== 200) {
        logger?.warn?.({ stage: 'thumb', status: res.statusCode, thumbUrl }, 'thumb download non-200');
        res.resume();
        return resolve(null);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', async () => {
        try {
          const buf = Buffer.concat(chunks);
          if (buf.length < 100) {
            logger?.warn?.({ stage: 'thumb', size: buf.length }, 'thumb too small');
            return resolve(null);
          }
          await fs.writeFile(filePath, buf);
          logger?.debug?.({ stage: 'thumb', filePath, size: buf.length }, 'thumb downloaded');
          resolve(filePath);
        } catch (e) {
          logger?.warn?.({ stage: 'thumb', err: e.message }, 'thumb write failed');
          resolve(null);
        }
      });
      res.on('error', (e) => {
        logger?.warn?.({ stage: 'thumb', err: e.message }, 'thumb download failed');
        resolve(null);
      });
    });
    req.on('error', (e) => {
      logger?.warn?.({ stage: 'thumb', err: e.message }, 'thumb request error');
      resolve(null);
    });
    req.setTimeout(15000, () => {
      logger?.warn?.({ stage: 'thumb', thumbUrl }, 'thumb download timeout');
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * 通过 page.evaluate + ClipboardEvent paste 把图片附加到 contenteditable input.
 *
 * Kimi / 豆包 都无 file input, 唯一可行路径: 模拟 paste 事件 + DataTransfer.
 * 必须在调用前先 click focus 到 input (Lexical / ProseMirror 才能接收).
 *
 * @param {Object} page - Playwright page
 * @param {Object} editorLocator - 已 focus 的 contenteditable locator
 * @param {string} filePath - 本地图片路径
 * @param {Object} [opts]
 * @param {string} [opts.editorSelector='div[contenteditable="true"]'] - 编辑器 selector
 * @param {Object} [opts.logger]
 * @returns {Promise<{ok: boolean, reason?: string, fileName?: string, size?: number}>}
 */
export async function pasteImageToEditor(page, editorLocator, filePath, opts = {}) {
  const editorSelector = opts.editorSelector || 'div[contenteditable="true"]';
  const logger = opts.logger;
  const buffer = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png'
            : ext === '.webp' ? 'image/webp'
            : ext === '.gif' ? 'image/gif'
            : 'image/jpeg';
  const fileName = path.basename(filePath);
  const dataBase64 = buffer.toString('base64');

  // 确认 focus
  await editorLocator.click();
  await new Promise(r => setTimeout(r, 300));

  const result = await page.evaluate(async ({ dataBase64, mime, fileName, editorSelector }) => {
    try {
      const bin = atob(dataBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });
      const file = new File([blob], fileName, { type: mime });
      const dt = new DataTransfer();
      dt.items.add(file);

      const editor = document.querySelector(editorSelector);
      if (!editor) return { ok: false, reason: 'editor not found: ' + editorSelector };

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt
      });
      editor.dispatchEvent(pasteEvent);
      return { ok: true, fileName, size: bytes.length };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }, { dataBase64, mime, fileName, editorSelector });

  logger?.debug?.({ stage: 'paste', result }, 'paste dispatch result');
  return result;
}

/**
 * 高层: 下载 + paste 一步完成. 失败不抛, 仅返回 false (上层 warn).
 *
 * @returns {Promise<boolean>} true = 上传成功, false = 跳过 (无 thumb / 失败)
 */
export async function uploadThumbToEditor(page, editorLocator, video, opts = {}) {
  const logger = opts.logger;
  const thumbUrl = video.thumb || video.cover_url;
  if (!thumbUrl) {
    logger?.debug?.({ stage: 'thumb', videoUrl: video.url }, 'no thumb field, skip upload');
    return false;
  }
  try {
    const filePath = await downloadThumbnail({ thumbUrl, videoUrl: video.url, logger });
    if (!filePath) return false;
    const result = await pasteImageToEditor(page, editorLocator, filePath, opts);
    if (!result.ok) {
      logger?.warn?.({ stage: 'thumb', videoUrl: video.url, reason: result.reason }, 'paste failed');
      return false;
    }
    // 等编辑器渲染
    await new Promise(r => setTimeout(r, 800));
    return true;
  } catch (e) {
    logger?.warn?.({ stage: 'thumb', videoUrl: video.url, err: e.message }, 'upload failed');
    return false;
  }
}
