/**
 * Douyin Collector — Scrape video favorites from Douyin (TikTok China)
 * 
 * MVP validated: 76 videos successfully scraped from "skills" collection
 */

export class DouyinCollector {
  constructor(context) {
    this.context = context;
    this.baseUrl = 'https://www.douyin.com';
  }

  /**
   * Collect all videos from a specified favorites collection
   * @param {string} collectionName - e.g. "skills"
   * @returns {Array} List of video items
   */
  async collect(collectionName) {
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
        
        if (link) {
          videos.push({
            url: link.startsWith('http') ? link : `${this.baseUrl}${link}`,
            title: title?.trim() || '',
            author: author?.trim() || '',
            likes: 0,
            thumb: thumb || '',
          });
        }
      }
    } finally {
      await page.close();
    }

    return videos;
  }
}
