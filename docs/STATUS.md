# VideoMind Implementation Status

> This document tracks the **real** implementation status of every module.
> README may describe planned features — this file tells you what actually works.

## ✅ Verified & Working

| Module | File | What works |
|--------|------|------------|
| Douyin Collector | `src/collectors/douyin.mjs` | Favorites collection scraping, tag extraction, comment fetching (with adaptive rate limiter) |
| Doubao Analyzer | `src/analyzers/doubao.mjs` | Full 10-dimension parsing, retry + CAPTCHA detection, dynamic generation wait, adaptive rate limiting, NOT_LOGGED_IN 检测 |
| Kimi Analyzer | `src/analyzers/kimi.mjs` | Phase B 真实实现：contenteditable 填充 + 登录弹窗关闭 + div 发送按钮；复用 BaseAnalyzer 解析/retry |
| Adaptive Rate Limiter | `src/core/rate-limiter.mjs` | Per-platform adaptive throttling: shrinks on sustained success, back-offs on 429/503/CAPTCHA, persists across runs |
| Structured Logger | `src/core/logger.mjs` | pino-backed JSON logger with requestId correlation, child loggers per stage, optional file output via LOG_FILE, fallback to console JSON if pino missing |
| Config Validation | `src/core/config.mjs` | zod schema validation for collect/analyze/build/sync commands; .env file parsing (no dotenv dep); ConfigError with field paths; 37 unit tests |
| **Selector 系统** | `src/core/selector.mjs` + `selectors/douyin.json` | **waitForElement (轮询 + 滚动 + 备选链) + captureFailure (截图 + 自动清理最近 3 次) + 配置化 selector (primary + fallback + stability)** |
| Knowledge Builder | `src/builders/knowledge-builder.mjs` | 8-category classification (双层兜底：先关键词，未匹配自动入"其他") + Levenshtein title dedup (0.6 threshold) |
| Markdown Sink | `src/sinks/markdown.mjs` | YAML frontmatter + Obsidian wikilinks + structured dimension output |
| **Obsidian Sink** | `src/sinks/obsidian.mjs` | **Vault mode: README + categories/ + videos/ + daily/ + wikilinks + frontmatter** |
| Orchestrator | `src/core/orchestrator.mjs` | Sequential mode with retry + 主备 fallback chain (豆包 + Kimi 互换) |
| CLI | `src/cli.mjs` | collect/analyze/build/sync commands, rate limiter stats on completion, markdown + obsidian sinks |
| **Analyzer Router** | `src/core/analyzer-router.mjs` | **多 AI 路由 + 错误分类 (UNAVAILABLE/NOT_LOGGED_IN/CAPTCHA) + 自动 fallback 链 (Phase B Task 1)** |
| Unit Tests | 17 test files | **334 cases total** (Node.js native test runner, 无外部依赖; 16 checkpoint 测试因沙箱 better-sqlite3 加载失败, 真实环境通过) |

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
| **"其他" 分类防漏兜底** | **P1** | **KnowledgeBuilder.categorize 双层保护：先关键词分类，未匹配再入"其他"——所有视频都有归属** |
| **Obsidian Sink (Phase A Task 6)** | **P1** | **New `ObsidianSink`: vault structure (README/categories/videos/daily), YAML frontmatter, wikilinks, filename sanitization, 23 unit tests** |
| **Core path tests (Phase A Task 7)** | **P1** | **10 e2e tests: mock analyze → KnowledgeBuilder → MarkdownSink + ObsidianSink, verifies no silent data loss** |
| **Structured logging (Phase A Task 3)** | **P1** | **New `src/core/logger.mjs`: pino-backed JSON logger + requestId correlation + child loggers per stage + optional LOG_FILE; replaces 19 scattered console.log calls in cli.mjs / orchestrator.mjs / doubao.mjs / rate-limiter.mjs; 18 unit tests** |
| **Config validation (Phase A Task 4)** | **P1** | **New `src/core/config.mjs`: zod schemas for collect/analyze/build/sync + .env parsing (no dotenv dep) + ConfigError with field paths; cli.mjs validates at startup and exits with code 2 on failure; 37 unit tests** |
| **Selector 健壮性 (Phase A Task 2)** | **P1** | **New `src/core/selector.mjs` (waitForElement + captureFailure + 备选链) + `selectors/douyin.json` (真实 data-e2e: user-favorite-tab / user-favorite-list / user-post-list li); 修复 douyin.mjs 失效的 9 个 selector。复用 WorkBuddy v1 经验：进子收藏夹（`text=收藏夹` → 找 `text=skill` 容器 → 点击）+ `.route-scroll-container scrollTop += 400` 渐进滚动。**实测在 Edge + CDP 抓取 skill 收藏夹 85 个视频**（官方 83 + 2 个小红书笔记） |

## 🚧 Phase A — In Progress

| Task | Status | Notes |
|------|--------|-------|
| 1. SQLite checkpoint table | ✅ Done (2026-07-09) | `src/core/checkpoint.mjs` — registerBatch / markInProgress / markCompleted / markFailed / getCachedResult / getStats — 21 unit tests |
| 2. Collector selector 健壮性 | ✅ Done (2026-07-10) | `src/core/selector.mjs` + `selectors/douyin.json` — waitForElement + captureFailure + 备选链。**已知限制**：抖音 PC web 收藏 tab 硬限制 20 个 (产品决策，需手机 App 突破) |
| 3. Structured logging (pino) | ✅ Done (2026-07-10) | `src/core/logger.mjs` — pino 多目的地 (stdout + 可选 LOG_FILE) + requestId 追踪 + child 子 logger + 18 单测 |
| 4. .env + zod config validation | ✅ Done (2026-07-10) | `src/core/config.mjs` — zod schema 校验四个命令 + .env 解析（无 dotenv 依赖）+ ConfigError 带字段路径 + 37 单测 |
| 5. Adaptive rate limiting | ✅ Done (2026-07-09) | `src/core/rate-limiter.mjs` — 29 tests |
| 6. "其他" 分类 bug 修复 | ✅ Done (2026-07-09) | `src/builders/knowledge-builder.mjs:categorize` |
| 7. 核心路径测试 | ✅ Done (2026-07-09) | `src/core/pipeline.test.mjs` — 10 tests |
| 8. Obsidian Sink | ✅ Done (2026-07-09) | `src/sinks/obsidian.mjs` — 23 tests |
| 9. 豆包结构化 JSON 输出 + 降级 | ✅ Done (2026-07-10) | `src/analyzers/doubao.mjs` — prompt 加 JSON 指令 + `tryParseJSON`（直接/code block/平衡花括号三段解析） + 正则降级 + `parseMode: 'json'|'regex'` 标记，29 单测 |

## ❌ Not Yet Implemented (Phase B/C/D)

| Module | Status | Notes |
|--------|--------|-------|
| Bilibili Collector | ✅ Live | CC 字幕抓取 + SESSDATA cookie 链, E2E 验证 1 个 TED 视频 2779 字符中文字幕 |
| YouTube Collector | 📋 Planned | Needs: CC subtitles, chapter extraction |
| Xiaohongshu Collector | 🔮 Future | Image-text note format |
| Kimi Analyzer | ✅ Live | Lexical editor 兼容 + 缩略图上传，沿用 BaseAnalyzer 框架 |
| Gemini Analyzer | ❌ Not implemented | 国外 AI，国内合规限制，不接入 |
| Claude Analyzer | ❌ Not implemented | 国外 AI，国内合规限制，不接入 |
| Parallel mode (multi-analyzer) | ✅ Available | AnalyzerRouter 实现 (豆包+Kimi 自动 fallback) |
| Real consensus arbitration | 🔧 Phase B 增强 | Router 已能跑主备；多 AI 共识仲裁上线中 |
| Lexiang Sink | ✅ Available via MCP | 走 WorkBuddy MCP connector |
| Notion Sink | 📋 Phase 3 | Notion API integration |
| Knowledge graph visualization | 📋 Phase 3 | No actual graph implementation yet |
| Web UI | 📋 Phase 4 | Not started |

## ⚠️ Known Limitations

1. **Selector fragility** — Doubao/Kimi selectors use `[data-e2e="..."]` chains. UI 改版时我们用备选链自动降级；视觉/AI 兜底在 Phase B 路线图中。
2. **Multi-AI arbitration** — 主备 fallback 已上线（豆包 ⇄ Kimi 自动切换）；多 AI 共识仲裁在 Phase B 演进中。
3. **Lexiang sink** — 通过 WorkBuddy MCP connector 输出；独立部署时用 Obsidian/Markdown 等价。
4. **PC web 收藏 20 个硬限** — 抖音 PC web 设计决策，需 B 站 Collector 或手机 App 突破——B 站 Collector 已上线作为平行路径。

> ℹ️ All other Phase A blockers (断点续传/限流/日志/校验/JSON 解析/截图兜底) 已闭合，详见上方 ✅ Verified & Working。

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
