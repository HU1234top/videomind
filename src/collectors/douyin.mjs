/**
 * Douyin Collector — Scrape video favorites from Douyin (TikTok China)
 * 
 * MVP validated: 76 videos successfully scraped from "skills" collection
 * 
 * Key capabilities:
 * - Bypass download protection: operates in browser, no downloads needed
 * - Extract #topic tags: auto-classify from Douyin's tag system
 * - Harvest comments: top N comments as AI analysis input
 * - Get cover images: assist AI visual understanding
 * - Speech-to-text via web AI: no local Whisper needed
 */

import { getLimiter } from '../core/rate-limiter.mjs';

export class DouyinCollector {
  constructor(context) {
    this.context = context;
    this.baseUrl = 'https://www.douyin.com';
    this.limiter = getLimiter('douyin');
  }

  /**
   * Collect all videos from a specified favorites collection
   * @param {string} collectionName - e.g. "skills"
   * @param {Object} options - { maxComments: 5, includeTags: true }
   * @returns {Array} List of video items with enriched metadata
   */
  async collect(collectionName, options = {}) {
    const { maxComments = 5, includeTags = true } = options;
    const page = await this.context.newPage();
    const videos = [];

    try {
      // Step 1: Navigate to user profile
      await page.goto(`${this.baseUrl}/user/self`);

      // Step 2: Find the favorites tab
      await page.click('[data-e2e="user-favorites"]');
      await page.waitForTimeout(1000);

      // Step 3: Find the specific collection by name
      const collectionCard = await page.locator(
        `.favorites-collection-card >> text="${collectionName}"`
      ).first();
      await collectionCard.click();
      await page.waitForTimeout(1000);

      // Step 4: Scroll to load all videos
      let prevCount = 0;
      let noNewCount = 0;
      while (noNewCount < 3) {
        await page.evaluate(() => window.scrollBy(0, 500));
        await page.waitForTimeout(800);
        const currentCount = await page.locator('.video-card').count();
        if (currentCount === prevCount) noNewCount++;
        else noNewCount = 0;
        prevCount = currentCount;
      }

      // Step 5: Extract video data from all loaded cards
      const cards = await page.locator('.video-card').all();
      for (const card of cards) {
        const link = await card.locator('a').first().getAttribute('href');
        const title = await card.locator('.title').textContent().catch(() => '');
        const author = await card.locator('.author').textContent().catch(() => '');
        const thumb = await card.locator('img').first().getAttribute('src').catch(() => '');
        
        // Extract #topic tags from title (Douyin format: "标题 #标签1 #标签2")
        const tags = includeTags ? this.extractTags(title) : [];
        
        if (link) {
          videos.push({
            url: link.startsWith('http') ? link : `${this.baseUrl}${link}`,
            title: title?.trim() || '',
            author: author?.trim() || '',
            tags: tags,                   // Douyin #topic tags
            likes: 0,
            thumb: thumb || '',           // Cover image for AI visual analysis
            comments: [],                 // To be filled in per-video phase
            transcript: '',               // To be obtained via web AI speech understanding
            // NOTE: No video file download needed!
            // Douyin has anti-download protection; we operate
            // entirely in the browser, letting web AI "watch" 
            // the video like a human would.
          });
        }
      }

      // Step 6: Per-video enrichment (comments, transcript preview)
      // This happens separately in the analyze phase when we open
      // each video page. The DouyinCollector handles bulk metadata
      // extraction, while DoubaoAnalyzer handles per-video deep dive.
      
    } finally {
      await page.close();
    }

    return videos;
  }

  /**
   * Extract #topic tags from Douyin video title
   * Douyin titles use format: "正文内容 #标签1 #标签2 #标签3"
   * @param {string} title - Raw video title
   * @returns {Array} List of extracted tags
   */
  extractTags(title) {
    if (!title) return [];
    // Match #tag pattern, but exclude pure numbers (#123赞 → skip #123)
    const tagRegex = /#([^\s#]+)/g;
    const tags = [];
    let match;
    while ((match = tagRegex.exec(title)) !== null) {
      const tag = match[1];
      // Filter: skip tags that start with digits (like #123赞, #456浏览)
      if (/^\d/.test(tag)) continue;
      // Skip very short tags (single char noise)
      if (tag.length <= 1) continue;
      tags.push(tag);
    }
    return tags;
  }

  /**
   * Fetch comments for a specific video
   * Called during the analyze phase for per-video enrichment
   * @param {string} videoUrl - Douyin video URL
   * @param {number} maxComments - Maximum comments to fetch
   * @returns {Array} List of comment objects
   */
  async fetchComments(videoUrl, maxComments = 5) {
    // Adaptive pre-request delay
    await this.limiter.delay();

    const page = await this.context.newPage();
    const comments = [];
    const t0 = Date.now();

    try {
      await page.goto(videoUrl);
      await page.waitForLoadState('networkidle');

      // Scroll to load comments section
      await page.waitForTimeout(2000);

      // Extract visible comments
      const commentElements = await page.locator('.comment-item, [data-e2e="comment-item"]').all();
      for (let i = 0; i < Math.min(commentElements.length, maxComments); i++) {
        const el = commentElements[i];
        const text = await el.locator('.comment-text, .content').textContent().catch(() => '');
        const author = await el.locator('.comment-author, .username').textContent().catch(() => '');
        if (text) {
          comments.push({ author: author?.trim() || '', text: text.trim() });
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
