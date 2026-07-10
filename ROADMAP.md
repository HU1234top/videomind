# VideoMind Roadmap

> **不是承诺，是路线图**。每项的实际状态以 [docs/STATUS.md](docs/STATUS.md) 为准。

## 当前阶段：Phase A 固本

让 MVP 在生产场景下**可恢复、可观察、可验证**。Phase 1 跑通的 76 视频是 happy path，中断就丢、selector 崩就瘫、配置错就报错。Phase A 解决这些。

| # | 任务 | 状态 | 工作量 | 备注 |
|---|------|------|------:|------|
| **5** | **响应式 rate limiting** | ✅ Done (2026-07) | 1d | 自适应快慢、成功加速、节流退避、慢响应预警、状态持久化 |
| 1 | SQLite checkpoint 断点续传 | ✅ Done (2026-07) | 1d | `src/core/checkpoint.mjs` — 注册/状态机/缓存读取，21 单测 |
| 2 | 采集层 selector 视觉 fallback | 📋 Planned | 2-3d | 截图+OCR 兜底（Phase 2 抖音改版时会救命） |
| 3 | pino/winston 结构化日志 | ✅ Done (2026-07) | 0.5d | `src/core/logger.mjs` — pino 多目的地（stdout+可选 LOG_FILE）+ requestId 追踪 + child 子 logger + 18 单测 |
| 4 | .env + zod 配置校验 | 📋 Planned | 0.5d | 启动时报错而非运行时崩溃 |
| 6 | 修"其他"分类 keywords=[] bug | ✅ Done (2026-07) | 0.5h | "其他" 现作为兜底，未匹配视频不再被丢弃 |
| 7 | 核心路径测试（mock analyze → build → markdown） | ✅ Done (2026-07) | 1.5h | 10 个端到端测试覆盖 build → markdown + obsidian |
| 8 | 豆包结构化 JSON 输出 + 降级 | ✅ Done (2026-07) | 1d | `tryParseJSON` 三段解析（直接/code block/平衡花括号） + 正则降级 + 29 单测 |
| 9 | Obsidian Sink | ✅ Done (2026-07) | 2h | vault 结构 + wikilinks + frontmatter + daily note |

## Phase B: 增效

平台/Analyzer 横向扩展，让 PoC 变成多源工具。

| # | 任务 | 状态 | 工作量 |
|---|------|------|------:|
| 9 | Kimi Analyzer | 📋 Planned | 1-2d |
| 10 | Gemini Analyzer | 📋 Planned | 1-2d |
| 11 | Claude Analyzer | 📋 Planned | 1-2d |
| 12 | B 站 Collector（弹幕/分P/UP主） | 📋 Planned | 2-3d |
| 13 | YouTube Collector（CC 字幕/Chapters） | 📋 Planned | 2-3d |
| 14 | Analyzer Router（自动选 AI） | 📋 Planned | 2d |
| 15 | 并发调度器（任务优先级队列） | 📋 Planned | 2-3d |
| 16 | 第二个 AI 交叉验证 + 字段置信度 | 📋 Planned | 2-3d |

## Phase C: 做深

从"工具"升级到"知识产品"。

| # | 任务 | 状态 | 工作量 |
|---|------|------|------:|
| 17 | 多级标签体系（领域→技术→具体工具） | 📋 Planned | 1d |
| 18 | 知识图谱实体化（前置依赖关系） | 📋 Planned | 3-5d |
| 19 | 可执行学习路径生成 | 📋 Planned | 2d |
| 20 | 本地 Web UI（搜索 + 技能地图） | 📋 Planned | 3-5d |
| 21 | Notion Sink（API 集成） | 📋 Planned | 2-3d |
| 22 | Obsidian Sink（vault 配置 + wikilink 高级用法） | 📋 Planned | 1d |

## Phase D: 开源打磨

让社区能参与、能贡献、能使用。

| # | 任务 | 状态 | 工作量 |
|---|------|------|------:|
| 23 | .github/workflows CI（lint + test + build） | 📋 Planned | 0.5d |
| 24 | CONTRIBUTING.md 贡献指南 | 📋 Planned | 0.5d |
| 25 | SECURITY.md 安全策略 | 📋 Planned | 0.5d |
| 26 | npm publish（package.json + bin 入口） | 📋 Planned | 0.5d |
| 27 | 插件市场（第三方 Adapter/Analyzer/Sink） | 🔮 Future | — |
| 28 | 云端部署方案（可选） | 🔮 Future | — |

---

## 优先级原则

1. **Phase A > 一切** — 没有稳固底座就堆功能 = 在沙地上盖楼
2. **每完成一个 Phase 才进下一个** — 不允许 Phase B 没做完就开 Phase C
3. **每完成一个 Task 必须更新 STATUS.md** — 诚实标注 verified/experimental/planned
4. **每个 PR 必须过测试** — `node --test src/**/*.test.mjs`
5. **selector 改了必须标注真实 DOM 来源** — 抖音改版时知道去哪查