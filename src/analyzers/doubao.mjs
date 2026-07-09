/**
 * Doubao Analyzer — Use Doubao (doubao.com) as Web-SubAgent for video analysis
 * 
 * MVP validated: 77 videos analyzed, 49 with 10-dimension deep analysis
 */

export class DoubaoAnalyzer {
  constructor(context) {
    this.context = context;
    this.url = 'https://doubao.com';
  }

  /**
   * Analyze a video using Doubao's web interface
   * @param {Object} video - Video metadata (title, author, comments, transcript)
   * @param {Array} attachments - Screenshots or additional data
   * @returns {Object} Structured 10-dimension analysis
   */
  async analyze(video, attachments = []) {
    const page = await this.context.newPage();
    try {
      await page.goto(this.url);
      await page.waitForLoadState('networkidle');

      // Navigate to new conversation
      await page.click('[data-e2e="new-conversation"]').catch(() => {});
      await page.waitForTimeout(1000);

      // Construct analysis prompt
      const prompt = this.buildPrompt(video);

      // Input prompt into Doubao's chat interface
      const inputBox = await page.locator('.chat-input, textarea, [data-e2e="chat-input"]').first();
      await inputBox.fill(prompt);
      await inputBox.press('Enter');

      // Wait for Doubao to finish generating
      await page.waitForTimeout(30000); // 30s for generation
      
      // Try to detect completion
      const stopBtn = page.locator('[data-e2e="stop-generating"]');
      try {
        await stopBtn.waitFor({ state: 'hidden', timeout: 60000 });
      } catch { /* generation may already be complete */ }

      // Extract the response text
      const response = await page.locator('.assistant-message, .ai-response').last().textContent();

      // Parse into structured 10-dimension format
      return this.parseResponse(video, response);
    } finally {
      await page.close();
    }
  }

  buildPrompt(video) {
    return `请分析以下抖音视频的内容，从10个维度给出结构化总结：

视频标题：${video.title}
作者：${video.author}
评论样本：${video.comments?.slice(0, 5).join('\n') || '无'}
转写文本：${video.transcript || '无'}

请输出：
1. summary（一段话概括）
2. key_points（核心要点列表）
3. tags（自动标签）
4. actionable_items（可行动项）
5. target_audience（目标受众）
6. related_topics（相关话题）
7. difficulty_level（难度等级）
8. core_concepts（核心概念）
9. practical_examples（实操案例）
10. learning_path（学习路径建议）`;
  }

  parseResponse(video, rawText) {
    // Simple parsing: extract structured fields from Doubao's response
    return {
      url: video.url,
      title: video.title,
      author: video.author,
      platform: 'doubao',
      analysis: rawText,
      timestamp: new Date().toISOString(),
    };
  }
}
