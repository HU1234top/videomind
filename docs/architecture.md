# VideoMind Architecture

## System Overview

VideoMind is a 5-layer pipeline that transforms video favorites into structured knowledge:

### Layer 1: Collector (采集层)

Connects to user's local browser via Chrome DevTools Protocol (CDP :9222). Each platform has an Adapter implementing a unified `collect()` interface.

**Key Design Decisions:**
- CDP over standalone browser: avoids login/Cookie management, uses user's existing session
- Platform-specific Adapters: different DOM selectors, scroll patterns, data extraction logic
- Scroll-until-stable: many platforms lazy-load content, so we scroll until no new items appear

### Layer 2: Orchestrator (编排层)

Decides analysis strategy:
- **Sequential mode**: Primary AI + Fallback chain. Efficient for batch processing.
- **Parallel mode**: 3+ AI analyze simultaneously + Consensus arbitration. Accurate for key content.

### Layer 3: Analyzer (分析层 — Web-SubAgent)

Wraps web AI platforms as callable SubAgents via Playwright:
1. Navigate to AI platform
2. Input structured prompt (video metadata + comments + transcript)
3. Wait for generation
4. Extract response text
5. Parse into 10-dimension schema

**Fallback mechanism**: If primary analyzer fails (timeout, rate-limit, CAPTCHA), try next in chain.

### Layer 4: Builder (构建层)

Post-processing pipeline:
- **Filter**: Identify AI-relevant content vs noise
- **Categorize**: Auto-tag into 8 categories using keyword matching
- **Deduplicate**: Remove near-similar videos (>80% title overlap)
- **Structure**: Generate knowledge graph nodes and edges

### Layer 5: Sink (输出层)

Each Sink implements a `sink()` interface accepting the KnowledgeBase schema:
- MarkdownSink: writes category files + overview
- LexiangSink: publishes to Lexiang knowledge base via MCP Connector
- ObsidianSink: generates Obsidian-compatible vault structure
- NotionSink: creates Notion pages via API/automation

## Data Flow

```
User → "Collect my skills favorites"
    │
    ▼
Collector → video_list.json (76 items)
    │
    ▼
Orchestrator → "Sequential mode, Doubao primary"
    │
    ▼
DoubaoAnalyzer → doubao_analysis_results.json (77 analyses)
    │
    ▼
KnowledgeBuilder → structured_knowledge_base.json (8 categories)
    │
    ▼
MarkdownSink + LexiangSink → 6 category files + 6 Lexiang pages
```

## Adding New Components

### New Platform Adapter

```javascript
// src/collectors/newplatform.mjs
export class NewPlatformCollector {
  constructor(context) {
    this.context = context;
  }
  async collect(collectionName) {
    // Implement: navigate → scroll → extract → return video array
  }
}
```

### New Analyzer

```javascript
// src/analyzers/newanalyzer.mjs
export class NewAnalyzer {
  constructor(context) { this.context = context; }
  async analyze(video, attachments) {
    // Implement: navigate → prompt → wait → extract → parse → return analysis
  }
}
```

### New Sink

```javascript
// src/sinks/newsink.mjs
export class NewSink {
  constructor(options) {}
  async sink(knowledgeBase) {
    // Implement: accept KB schema → write to target system
  }
}
```

## Performance Considerations

- **Rate limiting**: 5-10 second delay between videos to avoid platform bans
- **CAPTCHA handling**: Stop automation, prompt user for manual intervention
- **Memory**: Each browser tab consumes ~50MB; close tabs after analysis
- **Parallel limits**: Max 3 concurrent analyzers to avoid web AI rate-limits
