# VideoMind Implementation Status

> This document tracks the **real** implementation status of every module.
> README may describe planned features — this file tells you what actually works.

## ✅ Verified & Working

| Module | File | What works |
|--------|------|------------|
| Douyin Collector | `src/collectors/douyin.mjs` | Favorites collection scraping, tag extraction, comment fetching (with adaptive rate limiter) |
| Doubao Analyzer | `src/analyzers/doubao.mjs` | Full 10-dimension parsing, retry + CAPTCHA detection, dynamic generation wait, adaptive rate limiting |
| Adaptive Rate Limiter | `src/core/rate-limiter.mjs` | Per-platform adaptive throttling: shrinks on sustained success, back-offs on 429/503/CAPTCHA, persists across runs |
| Knowledge Builder | `src/builders/knowledge-builder.mjs` | 8-category classification with first-pass + catch-all (fixes "其他" drop), Levenshtein title dedup (0.6 threshold) |
| Markdown Sink | `src/sinks/markdown.mjs` | YAML frontmatter + Obsidian wikilinks + structured dimension output |
| Obsidian Sink | `src/sinks/obsidian.mjs` | Full vault structure (README/categories/videos/daily), YAML frontmatter, wikilinks, 10-dimension rendering, filename sanitization |
| Orchestrator | `src/core/orchestrator.mjs` | Sequential mode with retry + fallback, honest fallback chain (only doubao works) |
| CLI | `src/cli.mjs` | collect/analyze/build/sync commands, markdown + obsidian sinks, rate limiter stats on completion |
| Unit Tests | `src/core/rate-limiter.test.mjs` | 29 cases: success streak, throttle escalation, slow response, errors, persistence, registry, scenario simulation |
| Unit Tests | `src/sinks/obsidian.test.mjs` | 23 cases: vault structure, frontmatter, wikilinks, 10-dimensions, sanitization, daily note, e2e |
| Unit Tests | `src/core/pipeline.test.mjs` | 10 cases: full analyze→build→sync chain, error resilience, data loss detection |
| Unit Tests | `src/core/utils.test.mjs` | 12 cases: extractTags, dedup, parseResponse |

## 🔧 Recently Fixed

| Bug / Feature | Severity | Fix | Round |
|-----|----------|-----|-------|
| `browser.close()` kills user Chrome | P0 Critical | Changed to `browser.disconnect()` in cli.mjs + web-agent.mjs | R1 |
| 10 dimensions all null (fake data) | P0 Critical | Implemented real parseResponse with regex extraction | R1 |
| Duplicate fake DoubaoAnalyzer in web-agent.mjs | P0 Critical | Removed, import real DoubaoAnalyzer from analyzers/doubao.mjs | R1 |
| package.json main = nonexistent file | P0 | Changed to src/cli.mjs | R1 |
| "其他"分类 keywords=[] 永远 false → 视频被丢弃 | P1 | first-pass + catch-all 双阶段分配 | **R2** |
| Orchestrator signature mismatch | P1 | Unified to analyzer.analyze(video, options) | R1 |
| removeSimilarTitles no-op | P1 | Implemented Levenshtein-based dedup (threshold 0.6) | R1 |
| extractTags matches #123 | P1 | Filter tags starting with digits | R1 |
| No retry/CAPTCHA detection | P1 | Added exponential backoff (3 retries), CAPTCHA detection, dynamic wait | R1 |
| Comments never fetched in analyze phase | P2 | Added fetchComments call in analyze loop + enriched checkpoint | R1 |
| No YAML frontmatter/wikilinks | P2 | Added frontmatter + [[wikilinks]] + dimension sections in Markdown sink | R1 |
| Zero tests | P2 | Added 12 unit tests (extractTags, dedup, parseResponse) | R1 |
| Adaptive rate limiting (Phase A Task 5) | P1 | New AdaptiveRateLimiter class: learns from 429/503/CAPTCHA, shrinks on success, persists state, per-platform isolation, 29 tests | R1 |
| Obsidian Sink (Phase A Task 9) | P1 | Full vault structure: README MOC, categories/, videos/, daily/, wikilinks, 23 tests | **R2** |
| Core pipeline test (Phase A Task 7) | P2 | 10 end-to-end tests: mock analyze→build→markdown→obsidian, error resilience | **R2** |

## 🚧 Phase A — In Progress

| Task | Status | Notes |
|------|--------|-------|
| 1. SQLite checkpoint table | 📋 Next | Replace JSON intermediate state with `better-sqlite3` for true resume |
| 2. Collector selector visual fallback | 📋 Next | OCR/visual fallback when CSS selectors fail |
| 3. Structured logging (pino) | 📋 Next | Replace console.log with structured logger + requestId |
| 4. .env + zod config validation | 📋 Next | Startup validation instead of runtime crashes |
| 5. **Adaptive rate limiting** | **✅ DONE (R1)** | See `src/core/rate-limiter.mjs` — 29 tests |
| 6. **"其他" 分类 bug** | **✅ DONE (R2)** | first-pass + catch-all |
| 7. **核心路径测试** | **✅ DONE (R2)** | 10 e2e tests in `pipeline.test.mjs` |
| 8. 豆包结构化 JSON 输出 + 正则降级 | 📋 Next | Current regex parsing is fragile |
| 9. **Obsidian Sink** | **✅ DONE (R2)** | Full vault implementation, 23 tests |

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
| Obsidian configuration | ⚠️ Partial | Sink works, but no .obsidian vault config generated |
| Notion Sink | 📋 Phase 3 | Notion API integration |
| Knowledge graph visualization | 📋 Phase 3 | No actual graph implementation yet |
| Web UI | 📋 Phase 3 | Not started |

## ⚠️ Known Limitations

1. **Selector fragility** — Doubao selectors (`[data-e2e="..."]`, `.chat-input`) may break on UI updates. We use fallback selector chains but no visual/AI-based element detection yet.
2. **Single analyzer** — Only Doubao is implemented. If Doubao is down or rate-limited, analysis stops.
3. **No SQLite checkpoint** — `video_list_enriched.json` is saved, but no SQLite-based task state for true resume-from-failure. Note: rate limiter DOES persist state to JSON.
4. **Parallel mode** — Functional but useless with only 1 analyzer implemented.
5. **CI/CD** — No GitHub Actions pipeline yet. Tests must be run manually.
6. **No structured logging** — Still using console.log throughout.

## 📊 Rate Limiter Behavior

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

Default intervals: **Doubao** 6s→4s→90s · **Douyin** 5s→2s→30s.
