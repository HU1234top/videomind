/**
 * Bilibili Collector — 从 B 站抓视频 + CC 字幕
 *
 * Round 12 (Phase B-3): 解决"LLM 看不到视频内容"的根问题
 *
 * 关键能力：
 *   - 公开 view API 拿视频元信息（无需登录）
 *   - v2 API 拿真实字幕 URL（**需 SESSDATA cookie**，从 Edge 9222 CDP 拿）
 *   - CDN 下载字幕 JSON + 拼接成纯文本（公开 CDN，无需登录）
 *
 * 输出 schema 跟 DouyinCollector 一致（url/title/author/tags/transcript/comments）
 * 下游 analyzer (DoubaoAnalyzer) 看到 transcript 非空时直接基于内容分析，不再瞎猜
 */

import { readFileSync } from 'node:fs';
import { getLimiter } from '../core/rate-limiter.mjs';

const BILI_API_HEADERS = {
  Referer: 'https://www.bilibili.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'
};

export class BilibiliCollector {
  /**
   * @param {Object} context - Playwright BrowserContext（用于从 CDP 拿 cookie）
   * @param {Object} options
   * @param {Object} [options.logger] - pino logger
   */
  constructor(context, options = {}) {
    this.context = context;
    this.logger = options.logger || null;
    this.limiter = getLimiter('bilibili');
  }

  /**
   * 从 BrowserContext (CDP) 拿 B 站相关 cookie（特别是 SESSDATA + bili_jct）
   * @returns {Promise<string>} Cookie header 字符串
   */
  async _getBiliCookie() {
    if (!this.context) return '';
    try {
      const cookies = await this.context.cookies('https://www.bilibili.com');
      if (!cookies || cookies.length === 0) return '';
      return cookies.map(c => `${c.name}=${c.value}`).join('; ');
    } catch (e) {
      this.logger?.warn?.({ err: e.message }, 'failed to read bilibili cookies');
      return '';
    }
  }

  /**
   * 通过 fetch 调 B 站 API（带 login cookie）
   * 在 page context（浏览器内）执行，绕过 CORS + 共享 Edge cookie
   */
  async _apiInPage(url) {
    const page = this.context.pages()[0] || await this.context.newPage();
    if (!page.url().includes('bilibili.com')) {
      await page.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
    return page.evaluate(async (apiUrl) => {
      const r = await fetch(apiUrl, { credentials: 'include' });
      return { status: r.status, body: await r.text() };
    }, url);
  }

  /**
   * 抓单个视频的元信息 + 字幕（基于 BV 号）
   *
   * @param {string} bvid - 例 'BV1GJ411x7h7'，或完整 URL 自动提取
   * @returns {Promise<Object>} video item（schema 与 DouyinCollector 一致）
   */
  async collectOne(bvid) {
    // 1. 提取 BV 号
    const m = String(bvid).match(/BV[A-Za-z0-9]+/);
    if (!m) throw new Error(`Invalid BV id or URL: ${bvid}`);
    const bvId = m[0];
    const log = this.logger;

    // 2. 元信息（公开 API，无需 cookie）
    await this.limiter.delay();
    const viewResp = await this._apiInPage(`https://api.bilibili.com/x/web-interface/view?bvid=${bvId}`);
    const view = JSON.parse(viewResp.body);
    if (view.code !== 0 || !view.data) {
      throw new Error(`view API failed: ${view.code} ${view.message}`);
    }
    const info = view.data;
    const cid = info.cid;
    log?.debug?.({ bvId, cid, title: info.title }, 'bili view ok');

    // 3. 字幕 URL（v2 API，需 SESSDATA）
    await this.limiter.delay();
    let subtitles = [];
    try {
      const v2Resp = await this._apiInPage(`https://api.bilibili.com/x/player/v2?bvid=${bvId}&cid=${cid}`);
      const v2 = JSON.parse(v2Resp.body);
      if (v2.code === 0 && v2.data?.subtitle?.subtitles) {
        subtitles = v2.data.subtitle.subtitles;
      } else {
        log?.warn?.({ code: v2.code, msg: v2.message, needLogin: v2.data?.need_login_subtitle }, 'v2 returned no subtitles');
      }
    } catch (e) {
      log?.warn?.({ err: e.message }, 'v2 API call failed');
    }

    // 4. 选最优先字幕（人工 CC > AI；中文 > 英文）
    const best = this._pickBestSubtitle(subtitles);
    let transcript = '';
    if (best) {
      await this.limiter.delay();
      try {
        transcript = await this._downloadSubtitleJSON(best.subtitle_url);
        log?.info?.({ lan: best.lan_doc, ai_type: best.ai_type, length: transcript.length }, 'subtitle downloaded');
      } catch (e) {
        log?.warn?.({ err: e.message, url: best.subtitle_url }, 'subtitle download failed');
      }
    } else {
      log?.warn?.({ bvId }, 'no subtitles available');
    }

    // 5. 组装 video item (与 DouyinCollector schema 一致)
    return this._buildVideoItem(info, transcript);
  }

  /**
   * 字幕优先级排序策略：
   *   1. 人工 CC (ai_type=0) 优于 AI 字幕 (ai_type=1)
   *   2. 中文 (zh-CN/zh-Hans/zh-Hant/zh-HK) 优于其他
   *   3. 锁定字幕优先于公开（is_lock 不强制）
   */
  _pickBestSubtitle(subtitles) {
    if (!Array.isArray(subtitles) || subtitles.length === 0) return null;

    const scored = subtitles.map(s => {
      let score = 0;
      // 人工 CC
      if (s.ai_type === 0 || s.type === 0) score += 100;
      if (s.ai_type === 1 || s.type === 1) score += 50;
      // 中文
      if (/^zh/i.test(s.lan || '')) score += 30;
      // 优先简中
      if (s.lan === 'zh-CN' || s.lan === 'zh-Hans') score += 10;
      return { ...s, _score: score };
    });

    scored.sort((a, b) => b._score - a._score);
    return scored[0] || null;
  }

  /**
   * 下载字幕 CDN JSON + 拼接成纯文本
   *
   * JSON 结构（来自调研）：
   * {
   *   "body": [
   *     { "from": 0, "to": 3.39, "content": "...\n..." },  // 双语字幕 content 用 \n 分隔
   *     ...
   *   ]
   * }
   *
   * @param {string} cdnUrl - i0.hdslb.com/bfs/subtitle/*.json
   * @returns {Promise<string>} 纯文本（含时间戳便于核对）
   */
  async _downloadSubtitleJSON(cdnUrl) {
    const page = this.context.pages()[0] || await this.context.newPage();
    const resp = await page.evaluate(async (url) => {
      const r = await fetch(url);
      if (!r.ok) return { status: r.status, text: null, error: `HTTP ${r.status}` };
      return { status: r.status, text: await r.text() };
    }, cdnUrl);

    if (resp.status !== 200 || !resp.text) {
      throw new Error(resp.error || `subtitle fetch ${resp.status}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(resp.text);
    } catch (e) {
      throw new Error(`subtitle JSON parse failed: ${e.message}`);
    }

    const body = Array.isArray(parsed.body) ? parsed.body : [];
    if (body.length === 0) return '';

    // 拼接：双语字幕 content 用 \n 分隔，只取第一行（中文行通常在前）
    const lines = [];
    for (const seg of body) {
      const start = Math.floor(seg.from || 0);
      const m = Math.floor((seg.start || start) / 60);
      const s = Math.floor((seg.start || start) % 60);
      const ts = `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}]`;
      const text = String(seg.content || '').split('\n')[0].trim();
      if (text) lines.push(`${ts} ${text}`);
    }
    return lines.join('\n');
  }

  /**
   * 组装 DouyinCollector 兼容的 video item
   */
  _buildVideoItem(info, transcript) {
    const tags = [];
    if (info.tname_v2) tags.push(info.tname_v2);
    // B 站 tag 在 desc_v2 里以 #xxx# 形式
    const tagMatches = String(info.desc || '').match(/#([^#\s]+)#/g) || [];
    for (const t of tagMatches) {
      const tag = t.replace(/#/g, '').trim();
      if (tag && !tags.includes(tag)) tags.push(tag);
    }

    return {
      url: info.bvid ? `https://www.bilibili.com/video/${info.bvid}` : `https://www.bilibili.com/video/${info.aid}`,
      title: (info.title || '').trim(),
      author: info.owner?.name || '',
      tags,
      likes: info.stat?.like || 0,
      thumb: info.pic || '',
      collection: 'bilibili',
      comments: [],  // 评论可后续用 reply API，Round 12 不做
      transcript  // ★ 关键：填入视频字幕内容
    };
  }

  /**
   * 批量收集：传 BV 列表/URLs
   */
  async collectMany(bvidList, options = {}) {
    const { onError = 'skip' } = options;
    const results = [];
    for (const bv of bvidList) {
      try {
        const v = await this.collectOne(bv);
        results.push(v);
        this.logger?.info?.({ url: v.url, hasTranscript: !!v.transcript }, 'collected');
      } catch (e) {
        if (onError === 'fail') throw e;
        this.logger?.warn?.({ bv, err: e.message }, 'collect failed, skip');
      }
    }
    return results;
  }
}