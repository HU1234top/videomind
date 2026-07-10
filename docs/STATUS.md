# VideoMind Implementation Status

> This document tracks the **real** implementation status of every module.
> README may describe planned features — this file tells you what actually works.

## ✅ Verified & Working

| Module | File | What works |
|--------|------|------------|
| Douyin Collector | `src/collectors/douyin.mjs` | Favorites collection scraping, tag extraction, comment fetching (with adaptive rate limiter) |
| Doubao Analyzer | `src/analyzers/doubao.mjs` | Full 10-dimension parsing, retry + CAPTCHA detection, dynamic generation wait, adaptive rate limiting |
| Adaptive Rate Limiter | `src/core/rate-limiter.mjs` | Per-platform adaptive throttling: shrinks on sustained success, back-offs on 429/503/CAPTCHA, persists across runs |
| Knowledge Builder | `src/builders/knowledge-builder.mjs` | 8-category classification with "其他" catch-all (fixed: no silent drops), Levenshtein title dedup (0.6 threshold) |
| Markdown Sink | `src/sinks/markdown.mjs` | YAML frontmatter + Obsidian wikilinks + structured dimension output |
| **Obsidian Sink** | `src/sinks/obsidian.mjs` | **Vault mode: README + categories/ + videos/ + daily/ + wikilinks + frontmatter** |
| Orchestrator | `src/core/orchestrator.mjs` | Sequential mode with retry + fallback, honest fallback chain (only doubao works) |
| CLI | `src/cli.mjs` | collect/analyze/build/sync commands, rate limiter stats on completion, markdown + obsidian sinks |
| Unit Tests | `src/core/rate-limiter.test.mjs`, `src/sinks/obsidian.test.mjs`, `src/core/pipeline.test.mjs`, `src/core/checkpoint.test.mjs`, `src/analyzers/doubao-json.test.mjs` | 112 cases total: rate limiter (29), obsidian vault (23), e2e pipeline (10), checkpoint (21), JSON parser (29) |

## 🔧 Recently Fixed (from code review + Phase A)

| Bug / Feature | Severity | Fix |
|-----|----------|-----|
| `browser.close()` kills user Chrome | P0 Critical | Changed to `browser.disconnect()` in cli.mjs + web-agent.mjs |
| 10 dimensions all null (fake data) | P0 Critical | Implemented real parseResponse with regex extraction |
| Duplicate fake DoubaoAnalyzer in web-agent.mjs | P0 Critical | Removed, import real DoubaoAnalyzer from analyzers/doubao.mjs |
| package.json main = nonexistent file | P0 | Changed to src/cli.mjs |
| Orchestrator signature mismatch | P1 | Unified to analyzer.analyze(video, options) |
| removeSimilarTitles no-op | P1 | Implemented Levenshtein-based dedup (threshold 0.6) |
| extractTags matches #123 | P1 | Filter tags starting with digits |
| No retry/CAPTCHA detection | P1 | Added exponential backoff (3 retries), CAPTCHA detection, dynamic wait |
| Comments never fetched in analyze phase | P2 | Added fetchComments call in analyze loop + enriched checkpoint |
| No YAML frontmatter/wikilinks | P2 | Added frontmatter + [[wikilinks]] + dimension sections in Markdown sink |
| Zero tests | P2 | Added 12 unit tests (extractTags, dedup, parseResponse) |
| **Adaptive rate limiting (Phase A Task 5)** | **P1** | **New `AdaptiveRateLimiter` class: learns from 429/503/CAPTCHA, shrinks on success, persists state, per-platform isolation, 29 unit tests** |
| **"其他" 分类 keywords=[] bug** | **P1** | **Fixed: KnowledgeBuilder.categorize now uses first-pass + catch-all, no video is silently dropped** |
| **Obsidian Sink (Phase A Task 6)** | **P1** | **New `ObsidianSink`: vault structure (README/categories/videos/daily), YAML frontmatter, wikilinks, filename sanitization, 23 unit tests** |
| **Core path tests (Phase A Task 7)** | **P1** | **10 e2e tests: mock analyze → KnowledgeBuilder → MarkdownSink + ObsidianSink, verifies no silent data loss** |

## 🚧 Phase A — In Progress

| Task | Status | Notes |
|------|--------|-------|
| 1. SQLite checkpoint table | ✅ Done (2026-07-09) | `src/core/checkpoint.mjs` — registerBatch / markInProgress / markCompleted / markFailed / getCachedResult / getStats — 21 unit tests |
| 2. Collector selector visual fallback | 📋 Next | OCR/visual fallback when CSS selectors fail |
| 3. Structured logging (pino) | 📋 Next | Replace console.log with structured logger + requestId |
| 4. .env + zod config validation | 📋 Next | Startup validation instead of runtime crashes |
| 5. Adaptive rate limiting | ✅ Done (2026-07-09) | `src/core/rate-limiter.mjs` — 29 tests |
| 6. "其他" 分类 bug 修复 | ✅ Done (2026-07-09) | `src/builders/knowledge-builder.mjs:categorize` |
| 7. 核心路径测试 | ✅ Done (2026-07-09) | `src/core/pipeline.test.mjs` — 10 tests |
| 8. Obsidian Sink | ✅ Done (2026-07-09) | `src/sinks/obsidian.mjs` — 23 tests |
| 9. 豆包结构化 JSON 输出 + 降级 | ✅ Done (2026-07-10) | `src/analyzers/doubao.mjs` — prompt 加 JSON 指令 + `tryParseJSON`（直接/code block/平衡花括号三段解析） + 正则降级 + `parseMode: 'json'|'regex'` 标记，29 单测 |

## ❌ Not Yet Implemented (Phase B/C/D)

| Module | Status | Notes |
|--------|--------|-------|
| Bilibili Collector | 📋 Planned | Needs: danmaku extraction, multi-part video handling |
| YouTube Collector | 📋 Planned | Needs: CC subtitles, chapter extraction |
| Xiaohongshu Collector | 🔮 Future | Image-text note format |
| Kimi Analyzer | 📋 Planned | Web-SubAgent pattern, but needs separate page automation |
| Gemini Analyzer | 📋 Planned | Google auth + different UI selectors |
| Claude Analyzer | 📋 Planned | claude.ai interface automation |
| Parallel mode (multi-analyzer) | 📋 Planned | Only works when 2+ analyzers are implemented |
| Real consensus arbitration | 📋 Planned | Currently hardcode picks Doubao |
| Lexiang Sink | ⚠️ Partial | Was done via WorkBuddy MCP connector, not in repo code |
| Notion Sink | 📋 Phase 3 | Notion API integration |
| Knowledge graph visualization | 📋 Phase 3 | No actual graph implementation yet |
| Web UI | 📋 Phase 4 | Not started |

## ⚠️ Known Limitations

1. **Selector fragility** — Doubao selectors (`[data-e2e="..."]`, `.chat-input`) may break on UI updates. We use fallback selector chains but no visual/AI-based element detection yet.
2. **Single analyzer** — Only Doubao is implemented. If Doubao is down or rate-limited, analysis stops.
3. **No SQLite checkpoint** — `video_list_enriched.json` is saved, but no SQLite-based task state for true resume-from-failure. **Note**: rate limiter DOES persist state to JSON so resumed runs inherit learned rate.
4. **Parallel mode** — Functional but useless with only 1 analyzer implemented.
5. **GitHub repo not synced with WorkBuddy fixes** — The 18 fixes from the previous AI were applied in `WorkBuddy/users/.../videomind-github/` but not pushed. The current GitHub mirror may still be on v1. Always work from the WorkBuddy copy.

## 📊 Rate Limiter Behavior (Phase A Task 5)

The `AdaptiveRateLimiter` operates as a per-platform singleton that adapts:

| Event | Effect |
|-------|--------|
| 5 consecutive fast successes | Shrink interval by 10% (down to platform min) |
| Slow response (>threshold) | Light back-off (+25%) |
| 429 / "too many requests" | Aggressive back-off (2x/3x/5x per consecutive) |
| 503 / timeout | Moderate back-off (1x baseMult) |
| CAPTCHA / hard block | Severe back-off (severity 3, 5x multiplier) |
| Other transient error | Moderate increase (+50%) |
| Successful response after throttle | Reset streak, allow shrink to resume |

Default intervals (tuned from MVP):
- **Doubao**: 6s initial, 4s min, 90s max, 45s slow threshold
- **Douyin**: 5s initial, 2s min, 30s max, 20s slow threshold

State persists to `.videomind-rate-<platform>.json` so resumed runs inherit the learned rate.
