/**
 * Douyin Collector — Scrape video favorites from Douyin (TikTok China)
 *
 * Phase A Task 2 改造: 使用 selectors/douyin.json 配置化 selector
 *   - 不再硬编码 [data-e2e="user-favorites"] (已失效)
 *   - 用 waitForElement 处理懒加载
 *   - 用 captureFailure 保存失败现场
 *
 * Key capabilities:
 * - Bypass download protection: operates in browser, no downloads needed
 * - Extract #topic tags: auto-classify from Douyin's tag system
 * - Harvest comments: top N comments as AI analysis input
 * - Get cover images: assist AI visual understanding
 * - Speech-to-text via web AI: no local Whisper needed
 */

import { getLimiter } from '../core/rate-limiter.mjs';
import { loadSelectors, waitForElement, captureFailure } from '../core/selector.mjs';

export class DouyinCollector {
  constructor(context, options = {}) {
    this.context = context;
    this.baseUrl = 'https://www.douyin.com';
    this.limiter = getLimiter('douyin');
    this.logger = options.logger || null;
    const config = loadSelectors('douyin');
    this.config = config;
    this.selectors = config.selectors;  // selectors 子对象
  }

  /**
   * Collect all videos from favorites collection
   * @param {string} collectionName - 收藏夹名 (业务标签，默认 'skills')
   *   - 抖音 PC web 没有子收藏夹，只有"收藏"一个 tab
   *   - 此参数作为业务标签写入每条视频的 collection 字段
   *   - 用户可通过 CLI --collection-name 覆盖
   * @param {Object} options - { maxComments, includeTags, maxVideos }
   * @returns {Array} List of video items with enriched metadata
   */
  async collect(collectionName = 'skills', options = {}) {
    const {
      maxComments = 5,
      includeTags = true,
      maxVideos = Infinity
    } = options;

    const page = await this.context.newPage();
    const videos = [];
    const log = this.logger;

    log?.info?.({ collectionName, baseUrl: this.baseUrl }, 'douyin collect start');

    try {
      // ---- Step 1: 进收藏页 ----
      const favoritesUrl = `${this.baseUrl}/user/self?showTab=favorite_collection`;
      log?.debug?.({ url: favoritesUrl }, 'navigating to favorites page');
      await page.goto(favoritesUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      await sleep(3000);

      // ---- Step 2: 找子收藏夹 (如果 collectionName 不是默认 'favorites') ----
      // 抖音 PC web 收藏 tab 默认显示「全部收藏」；
      // 用户可在 App 建子收藏夹（如 "skill"），PC web 在 showSubTab=favorite_folder 显示
      if (collectionName && collectionName !== 'favorites') {
        log?.debug?.({ collectionName }, 'looking for sub-folder');

        // 进子收藏夹 tab
        const folderTab = await page.locator('text=收藏夹').first();
        if (await folderTab.count() > 0) {
          await folderTab.click();
          await sleep(3000);
          log?.debug?.({ url: page.url() }, 'switched to folder view');

          // 找目标子收藏夹 (文本严格匹配 collectionName + "共N作品" 容器)
          const folderClickResult = await page.evaluate((targetName) => {
            const all = document.querySelectorAll('*');
            for (const el of all) {
              const t = (el.textContent || '').trim();
              if (t === targetName) {
                let p = el.parentElement;
                for (let i = 0; i < 6 && p; i++) {
                  const pt = p.textContent || '';
                  if (pt.includes('共') && pt.includes('作品')) {
                    const sel = '.' + p.className.split(' ').filter(Boolean).join('.');
                    p.click();
                    return { selector: sel, containerText: pt.slice(0, 60) };
                  }
                  p = p.parentElement;
                }
              }
            }
            return null;
          }, collectionName);

          if (folderClickResult) {
            log?.info?.({ selector: folderClickResult.selector, count: folderClickResult.containerText }, 'clicked sub-folder');
            await sleep(4000);
          } else {
            log?.warn?.({ collectionName }, 'sub-folder not found, falling back to all favorites');
          }
        }
      }

      // ---- Step 3: 等收藏列表加载 ----
      const favList = await waitForElement(page, this.selectors.favoritesList, {
        logger: log,
        scrollTrigger: false,  // 列表已经在视口里了
        intervals: [3000, 5000]
      });
      if (!favList.element) {
        log?.error?.({ attempts: favList.attempts }, 'favorites list not found');
        await captureFailure(page, 'no-favorites-list', { logger: log });
        throw new Error('收藏列表加载失败 (可能未登录或抖音改版)');
      }
      log?.info?.({ selector: favList.selector }, 'favorites list loaded');

      // ---- Step 5: 滚动加载所有视频 (WorkBuddy extract_all_videos2.mjs 同款) ----
      log?.info?.({ maxVideos }, 'scrolling to load all videos');

      // 先滚到顶部，确保初始状态干净
      await page.evaluate(() => {
        const c = document.querySelector('.route-scroll-container');
        if (c) c.scrollTop = 0;
      });
      await sleep(1000);

      // 等收藏列表加载
      await waitForElement(page, this.selectors.favoritesList, {
        logger: log,
        scrollTrigger: false,
        intervals: [3000, 5000]
      }).catch(() => null);

      // ---- Step 6: 渐进式滚动 + 提取 (合并到一个循环) ----
      // WorkBuddy 方法: 每滚一次抓一次，用 uniqueUrls 判断是否停止
      // (.route-scroll-container 内部滚动 + scrollTop += 400)
      const seen = new Set();
      let stableCount = 0;
      const MAX_SCROLL_ATTEMPTS = 80;

      for (let i = 0; i < MAX_SCROLL_ATTEMPTS; i++) {
        // 滚 .route-scroll-container 内部 (不是 window)
        await page.evaluate(() => {
          const c = document.querySelector('.route-scroll-container');
          if (c) c.scrollTop += 400;
        });
        await sleep(1200);

        // 抓所有视频 link
        const rawVideos = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a[href*="/video/"], a[href*="/note/"]'))
            .map(a => {
              const img = a.querySelector('img');
              const titleSpan = a.querySelector('span[title], p[title]') || a;
              const title = titleSpan.getAttribute('title') || img?.alt || a.textContent?.trim() || '';
              return {
                url: a.href,
                title: title.slice(0, 300),
                thumb: img?.src || ''
              };
            });
        });

        const before = seen.size;
        for (const v of rawVideos) {
          if (seen.has(v.url)) continue;
          seen.add(v.url);
          const tags = includeTags ? this.extractTags(v.title) : [];
          videos.push({
            url: v.url.startsWith('http') ? v.url : `${this.baseUrl}${v.url}`,
            title: (v.title || '').trim(),
            author: '',
            tags,
            likes: 0,
            thumb: v.thumb || '',
            collection: collectionName,
            comments: [],
            transcript: ''
          });
        }
        const after = seen.size;

        if (i % 5 === 0 || i < 10) {
          log?.debug?.({ attempt: i + 1, uniqueUrls: after, newUrls: after - before }, 'scroll+extract progress');
        }

        if (videos.length >= maxVideos) break;

        // 停止条件: 5 次不增加新 URL (WorkBuddy extract_all_videos2.mjs 用 8 次)
        if (after === before) {
          stableCount++;
          if (stableCount >= 5) break;
        } else {
          stableCount = 0;
        }
      }

      log?.info?.({ videosExtracted: videos.length, uniqueUrls: seen.size }, 'douyin collect done');

    } catch (e) {
      log?.error?.({ err: e.message }, 'douyin collect failed');
      await captureFailure(page, 'collect-failed', { logger: log });
      throw e;
    } finally {
      await page.close();
    }

    return videos;
  }

  /**
   * Extract #topic tags from Douyin video title
   * Douyin titles use format: "正文内容 #标签1 #标签2 #标签3"
   */
  extractTags(title) {
    if (!title) return [];
    const tagRegex = /#([^\s#]+)/g;
    const tags = [];
    let match;
    while ((match = tagRegex.exec(title)) !== null) {
      tags.push(match[1]);
    }
    return tags;
  }

  /**
   * Fetch comments for a specific video
   * Called during the analyze phase for per-video enrichment.
   */
  async fetchComments(videoUrl, maxComments = 5) {
    await this.limiter.delay();

    const page = await this.context.newPage();
    const comments = [];
    const t0 = Date.now();

    try {
      await page.goto(videoUrl);
      await page.waitForLoadState('networkidle');
      await sleep(2000);

      // 评论 selector: 实测后用 [data-e2e] 或结构选择器
      const commentSelectors = [
        '[data-e2e="comment-item"]',
        '.comment-item',
        '[class*="comment-item"]',
        'li[class*="comment"]',
        'div[class*="CommentItem"]'
      ];

      let commentElements = [];
      for (const sel of commentSelectors) {
        const count = await page.locator(sel).count();
        if (count > 0) {
          commentElements = await page.locator(sel).all();
          break;
        }
      }

      for (let i = 0; i < Math.min(commentElements.length, maxComments); i++) {
        const el = commentElements[i];
        const text = await el.textContent().catch(() => '');
        if (text && text.trim()) {
          comments.push({ author: '', text: text.trim().slice(0, 500) });
        }
      }

      this.limiter.recordSuccess(Date.now() - t0);
    } catch (e) {
      this.limiter.recordError();
      throw e;
    } finally {
      await page.close();
    }

    return comments;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}