# Zero-Cost Guide

## Why VideoMind Costs $0

Traditional video analysis requires paid APIs or local GPU resources:

| Component | Traditional Cost | VideoMind Cost |
|-----------|-----------------|----------------|
| Video transcription | Whisper API ~$0.006/min | Free (via Doubao web) |
| Visual understanding | GPT-4o Vision ~$0.01/image | Free (via Doubao web) |
| Text summarization | GPT-4 ~$0.03/1K tokens | Free (via Doubao web) |
| **100 videos** | **$1–5** | **$0** |

## The Secret: Web-SubAgent Architecture

Instead of calling paid APIs, VideoMind:

1. **Opens your logged-in browser** via Chrome CDP
2. **Navigates to free web AI platforms** (Doubao, Kimi, etc.)
3. **Feeds video data as prompts** through Playwright automation
4. **Extracts structured responses** from web AI output
5. **Closes browser tab** and moves to next video

The web AI platforms treat this as normal user interaction — you're just using their free tier through automation instead of manually.

## Prerequisites for Zero-Cost Operation

1. **Chrome/Edge with CDP**: Already logged into Douyin, Doubao, etc.
2. **Doubao account**: Free tier allows unlimited chat sessions
3. **Kimi account**: Free tier for long-context summarization
4. **Gemini account**: Google account gives free access
5. **Claude account**: Free tier with limited messages (use as fallback)

## Rate-Limiting Strategy

Even though the API cost is $0, you still need to be respectful:

- **5–10 seconds** between each video analysis
- **30–60 seconds** per Doubao response (let it generate fully)
- **Stop on CAPTCHA** — don't try to bypass it
- **Max 3 parallel** analyzers to avoid web AI throttling

## If You Want to Add Paid APIs (Optional)

VideoMind's architecture also supports paid API routes:

```javascript
// Replace DoubaoAnalyzer with an API-backed version
export class GPT4VisionAnalyzer {
  async analyze(video, attachments) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o', messages: [...] })
    });
    return response.json();
  }
}
```

The Orchestrator's Fallback chain will naturally route to whichever analyzer is available.
