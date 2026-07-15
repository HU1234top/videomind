<div align="center">

# 🧠 VideoMind

### 让你的收藏夹学会思考

**Zero API Cost · Turn Video Favorites into a Living Knowledge Base**

[English](#english) | [中文](#中文)

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-blue.svg)](https://nodejs.org)
[![Playwright](https://img.shields.io/badge/playwright-core-orange.svg)](https://playwright.dev)

</div>

---

<!-- AEO / SEO meta (for AI crawlers like ChatGPT, Perplexity, Gemini) -->
<!-- Keywords: video to knowledge base, douyin scraper, bilibili analyzer, doubao ai, kimi ai, gemini, claude, agent, playwright, zero api cost, free ai, knowledge graph -->

<a id="中文"></a>

## 🚀 3 句话电梯演讲

1. **做什么**：把抖音/B站/YouTube 收藏夹里的几百个教程视频，自动转成**可检索、可链接、可复用的知识库**
2. **怎么做到**：本地 Agent 用 Playwright 操控你已登录的浏览器，把视频喂给**免费网页 AI**（豆包/Kimi/Gemini/Claude），**不下载视频、不付费 API**
3. **为什么**：传统方案要么下载不了（抖音防下载），要么 $1-5/100 视频（GPT-4o Vision），要么要 GPU（本地 Whisper+LLaVA）—— VideoMind = **零下载 + 零 API 费用 + 零 GPU**

## 🎯 一句话定位

把抖音/B站/YouTube 收藏夹里的视频，**零 API 成本**自动交给Web版多模态 AI（豆包、Kimi、Gemini、Claude 等）分析理解，最终沉淀为可检索、可关联、可复用的结构化知识库。

## 🤔 为什么做这个项目

你的收藏夹在吃灰吗？

- 抖音/B站收藏了几百个教程视频，但从来没系统看过
- 想学 AI / 编程 / 设计，收藏了一大堆，不知道从哪开始
- 视频太多，逐个看要花几十个小时

## 🚫 何时不用 VideoMind

- 你只有 5-10 个视频 —— 手动看更快
- 你需要**实时**视频理解 —— VideoMind 是批量处理
- 你需要**逐字稿**（word-by-word 转录）—— VideoMind 用 Web AI 理解，**不保证字字对应**
- 你无法在本地跑浏览器 —— Playwright + CDP :9222 是硬性要求

## 🆚 传统方案的痛点

| 步骤 | 痛点 |
|------|------|

| 步骤 | 痛点 |
|------|------|
| 下载视频 | 抖音有**防下载保护**，大量视频无法直接保存到本地 |
| 转录音频 | Whisper 本地转录需 GPU 算力；云端 API 按时长收费 |
| 分析内容 | GPT-4o Vision 等多模态 API **限流+按次收费**，100 个视频成本 $1-5 |
| 整理入库 | 人工手动分类、写摘要，效率极低 |

**VideoMind 的解决方案：不下载视频，不调付费 API，零成本完成全流程。**

核心思路：你已经在浏览器里登录了抖音和豆包/Kimi/Gemini——让 Agent 通过浏览器自动化，直接把视频信息喂给这些**免费网页 AI**，它们能看懂视频、读懂评论、总结内容，而且不限流、不收费。

## 🏆 已验证成果

> 这些数据来自一次真实的端到端跑通（2026-06，76-77 个抖音「skills」收藏夹视频）。

| 指标 | 数值 | 备注 |
|------|------|------|
| 抖音「skills」收藏夹抓取 | **76 个视频** | 实测通过 |
| 豆包 AI 深度分析 | **77 / 76 = 100% 覆盖** | 49 个获得 10 维度结构化输出，28 个为增强基础（评论+标签） |
| 评论数据提取 | 71 条 | 由豆包分析阶段附带产出 |
| AI 技术方向自动筛选 | 68 个 | 关键词过滤（详见 `knowledge-builder.mjs`） |
| 自动 8 类分类 | ✅ | 关键词匹配 + 防漏兜底（每个视频必落入分类） |
| 本地 Markdown 输出 | ✅ | YAML frontmatter + Obsidian wikilinks |
| 多模态视频理解 | ✅ | 豆包/Kimi 读视频画面；B 站自动取 CC 字幕喂给 AI |
| **总 API 成本** | **$0** | 全程浏览器自动化 + 免费网页 AI |

## 🏗️ 核心架构

```
Local Agent (编排调度)
    │
    ▼
Collector: 抖音/B站/YouTube Adapter
    │  ┌─ 防下载保护？直接在浏览器里看，不用下载
    │  ├─ 标签/话题系统？自动提取 #AI #编程 等标签
    │  ├─ 评论/弹幕？抓取前 N 条作为分析素材
    │  └─ 封面/关键帧？截图辅助 AI 视觉理解
    ▼
决策: 任务复杂度?
   │              │
串行模式          并行模式
(主力+Fallback)   (多模型共识仲裁)
   │              │
    └────────────┘
         │
         ▼
Analyzer: 豆包/Kimi/Gemini/Claude Web-SubAgent
         │  ┌─ 网页端免费额度，不限流
         │  ├─ 多模态理解：看封面+读评论+分析转写
         │  └─ 10维度技能聚焦分析框架
         ▼
Builder: 去重/标签(8类)/技能点/知识图谱
         │
         ▼
Sink: 乐享/Notion/Obsidian/Markdown
```

## 💡 零成本原理

| 方案 | 100视频成本 | 限制 |
|------|-----------|------|
| GPT-4o Vision API | $1-5 | 限流 + 按次收费 |
| Gemini Pro Vision API | $0.5-2 | 限流 + 需 API Key |
| 本地 Whisper + LLaVA | GPU 费用 | 需 GPU + 转录慢 |
| 下载视频 → 转音频 → API | 视频可能无法下载 | 抖音防下载保护 |
| **VideoMind（网页端 AI）** | **$0** | **无限流 · 无需下载** |

**怎么做到零成本的？**

1. **不下载视频** — 抖音有防下载保护，很多视频根本下载不了。VideoMind 直接在浏览器里操作，跟人看视频一样，绕过下载限制。
2. **复用你已登录的浏览器** — Chrome CDP :9222 连接真实浏览器，跳过登录和 Cookie 管理。
3. **利用网页版免费额度** — 豆包/Kimi/Gemini/Claude 都有网页端免费使用额度，且**不限流**。Playwright 自动化操作 = 免费调用多模态能力。
4. **本地 Agent 只做调度** — 规划任务、组装 prompt、合并结果，深度推理全交给免费 Web AI。

> 借鉴了 [AgentChat](https://github.com/) 的 Web-SubAgent 思想，但垂直聚焦于「视频 → 知识库」场景。

## 📖 三个真实使用场景

**场景 1：知识工作者的「第二大脑」**

> 你抖音收藏了 200 个 AI/编程/设计教程视频，但从来没系统看过。想学"Agent 架构"时不知道从哪开始。
>
> → VideoMind 跑一遍：76 个视频变成 76 个**结构化技能卡片**，自动分到 8 个类别。搜 "Agent" 直接定位到 3 个相关视频，看完就掌握。

**场景 2：自媒体的「选题灵感库」**

> 你想做 AI 教程视频，需要看同类博主最近在讲什么。手动翻 100 个视频太慢。
>
> → VideoMind 抓评论 + 标题 + 标签，**自动聚类热门话题**。直接看到"最近 30 天讲 Claude Code 的有 12 个视频"。

**场景 3：研究者的「文献综述替代」**

> 你研究 AI Agent 趋势，需要看 B 站/YouTube 上中英文相关视频的观点。
>
> → VideoMind 跑双 AI（豆包 + Kimi）做**字段级投票**，标 confidence + conflicts，**比单一 AI 准**。

## 🤔 VideoMind vs 同类工具

| 维度 | VideoMind | NotebookLM | 飞书妙记 | 录屏+Whisper | GPT-4o Vision API |
|------|-----------|------------|----------|--------------|-------------------|
| **100 视频成本** | $0 | 免费（需 Google 账号） | 免费（限 10 视频/月） | $0（要 GPU） | $1-5 |
| **支持平台** | 抖音/B站/YouTube | 仅 YouTube | 仅会议录音 | 任意 | 任意 |
| **无需下载视频** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **多 AI 共识** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **结构化技能分析** | ✅ (10 维度) | ❌（仅摘要） | ❌（仅摘要） | ❌ | ❌ |
| **离线可跑** | ✅ | ❌ | ❌ | ✅ | ❌ |
| **开源可改** | ✅ MIT | ❌ | ❌ | ✅ | ❌ |

**VideoMind 的差异化**：**多平台 + 零下载 + 多 AI 共识 + 结构化技能分析** —— 这 4 个能力组合，NotebookLM/飞书妙记都没有。

## ❓ FAQ（AI 搜索常抓）

### VideoMind 真的免费吗？
**完全免费**。使用豆包/Kimi/Gemini/Claude 的网页版免费额度，不需要 API Key，不需要付费账户。Playwright 自动化操作 = 免费调用多模态能力。

### 会违反抖音/B站 ToS 吗？
**仅用于个人学习研究**，遵守各平台 ToS：
- 不存储原视频文件（只存链接和结构化摘要）
- 建议每个视频间隔 5-10 秒
- 遇到验证码时停止自动化，人工处理

详见 [`⚠️ 负责使用`](#-负责使用) 章节。

### 需要 GPU 吗？
**不需要**。本地 Agent 只做调度（Playwright + 浏览器自动化），深度推理全部交给免费 Web AI。如果用本地 Whisper 转录才需要 GPU，但 VideoMind 默认**不下载视频、不转录**。

### 抓 100 个视频要多久？
实测 76 视频约 40 分钟（含 AI 分析时间）。如果 AI 分析是瓶颈，可调 `--analyze-mode parallel` 用多 AI 并行，**通常快 2-3 倍**。

### 跟别的 AI 总结工具有什么区别？
**核心差异**：VideoMind 把每个视频当作**一个可学习的技能单元**，输出 10 维度结构化（技能名称/等级/前置知识/学习路径等），而不是简单摘要。这套框架专为"收藏夹 = 技能库"场景设计。

### 我只会用 Chrome，不会用命令行怎么办？
VideoMind 是 CLI 工具，需要 `node src/cli.mjs` 启动。门槛是 Node.js 基础 + 会看终端输出。**没有 GUI**（Phase C 在规划 Web UI）。

### 可以商用吗？
**MIT License**，可商用。但你**要为内容合规负责**（见 ToS 章节）。

## 🚀 快速开始

### 前置要求

- Node.js >= 18
- Chrome / Edge 浏览器（已登录目标平台）
- 已登录豆包/Kimi 等网页 AI 账号

### 安装

```bash
git clone https://github.com/HU1234top/videomind.git
cd videomind
npm install
```

### 启动 Chrome（开启远程调试）

```bash
# Windows
chrome.exe --remote-debugging-port=9222

# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

### 运行

```bash
# 1. 采集抖音收藏夹（直接在浏览器里操作，无需下载视频）
node src/cli.mjs collect --platform douyin --collection skills

# 2. 用豆包分析所有视频（串行模式）
node src/cli.mjs analyze --analyzer doubao

# 3. 构建知识库
node src/cli.mjs build

# 4. 输出为 Markdown
node src/cli.mjs sync --sink markdown
```

## ⚙️ 配置（zod 校验 + .env 覆盖）

所有命令参数在启动时由 [`zod`](https://github.com/colinhacks/zod) schema 校验，错误立刻打印带字段路径的提示并退出（exit code 2）：

```bash
# 错误示例
$ node src/cli.mjs analyze --mode banana --analyzer gpt4
[ConfigError] Invalid configuration for command "analyze"

Configuration problems:
  - analyzer: Invalid option: expected one of "doubao"|"kimi"|"gemini"|"claude"
  - mode: Invalid option: expected one of "sequential"|"parallel"

Tip: check CLI args, env vars, or .env file. Run with --help to see defaults.
```

**优先级**：CLI args > 环境变量 > `.env` 文件 > defaults。

**用 `.env` 覆盖**（项目根新建 `.env`，参考 [`.env.example`](.env.example)）：

```bash
# .env
COLLECT_PLATFORM=bilibili
ANALYZE_MODE=parallel
ANALYZE_NO_CHECKPOINT=true
LOG_LEVEL=info
LOG_FILE=./videomind.log
```

支持的 env 变量按命令前缀分组（`COLLECT_*` / `ANALYZE_*` / `BUILD_*` / `SYNC_*`），未加前缀的全局变量（`LOG_LEVEL` / `LOG_FILE`）被 logger 消费。详见 [`src/core/config.mjs`](src/core/config.mjs)。

## 🪵 可观测性（结构化日志）

所有运行日志通过 [`pino`](https://github.com/pinojs/pino) 输出为 JSON，每行带 `requestId` / `stage` / `component` 字段，便于按批次关联：

```bash
# 默认：JSON 到 stdout
node src/cli.mjs analyze

# 输出到文件 + 调级别
LOG_LEVEL=debug LOG_FILE=./videomind.log node src/cli.mjs analyze

# 测试/CI 静音
LOG_LEVEL=silent node src/cli.mjs analyze
```

日志行示例：

```json
{"level":"info","time":"2026-07-10T03:32:22.944Z","name":"videomind","requestId":"210361d9-...","component":"analyzer","platform":"doubao","stage":"analyze","msg":"analyzed","url":"https://...","title":"Claude Code..."}
```

按 `requestId` 过滤可重建单个 analyze 批次的完整轨迹。详细字段约定见 [`src/core/logger.mjs`](src/core/logger.mjs)。

## 📊 技能聚焦分析框架（10维度）

每个视频经过深度分析后输出 **10 个技能学习维度**，专为「收藏夹 = 技能库」场景设计：

| # | 维度 | 说明 | 示例 |
|---|------|------|------|
| 1 | **技能名称** | 视频教的具体是什么技能 | "Claude 学习加速法" / "Firecrawl 免 API 爬取" |
| 2 | **技能等级** | 入门/中级/高级/专家 | 入门 → 专家 5 级 |
| 3 | **核心要点** | 3-5 个必须记住的关键点 | "6 步学习闭环"、"二八法则锁定核心" |
| 4 | **实操步骤** | 可直接照做的步骤清单 | Step 1: 拆分技能等级 → Step 2: ... |
| 5 | **工具/资源** | 视频提到的具体工具/网站 | AgentChat / Firecrawl / Claude |
| 6 | **避坑指南** | 作者提醒的常见错误 | "不要把 Claude 当搜索引擎"、"低价 API 缺多模态" |
| 7 | **适用场景** | 什么情况下用这个技能 | AI 自动化编程 / 网页数据采集 |
| 8 | **前置知识** | 学这个需要先掌握什么 | 基础 Python / 了解 Agent 架构 |
| 9 | **学习路径** | 跟哪些视频组合学习效果最好 | "先看 #3 Agent 入门 → 再看 #7 实操" |
| 10 | **关键词标签** | 自动生成的分类标签 | `#AI-Agent` `#爬虫` `#开源工具` |

> 💡 和通用「摘要+标签」不同，这个框架把每个视频当作**一个可学习的技能单元**来拆解，输出的是「我能学什么 → 怎么学 → 需要什么基础 → 跟什么搭配」的完整技能地图。

## 🎯 抖音收藏夹的特殊能力

抖音是 VideoMind 第一个验证的平台，因为它有几个独特挑战和优势：

### 绕过防下载保护
抖音视频有防下载机制，传统方案需要用第三方工具或录屏才能获取视频文件。VideoMind **不下载视频**，直接在浏览器里让 AI「看」视频——跟人类观看方式完全一样。

### 标签/话题系统
抖音视频自带 `#AI` `#编程` `#开源工具` 等话题标签，VideoMind 自动提取这些标签作为初始分类依据，结合 AI 分析进行二次归类。

### 评论数据采集
抖音评论区往往包含用户的真实反馈、补充说明、甚至作者本人的回复。VideoMind 抓取前 N 条评论作为 AI 分析的辅助素材——一条评论可能比视频标题更有价值。

### 语音转文字
豆包等网页 AI 可以直接理解视频中的语音内容，无需本地 Whisper 转录。

## 🔌 支持矩阵

> **状态图例**：
> - ✅ **Verified** — 实测通过，有数据支撑
> - 🟡 **Partial** — 部分功能能用，但有限制
> - 📋 **Planned** — 写在 roadmap 里，**代码还没写**
> - 🔮 **Future** — 远期想法，连设计都没定

### ✅ 现在能跑（实测）

| 模块 | 平台/工具 | 验证场景 |
|------|----------|----------|
| Collector | 🇨🇳 抖音 + 🎬 B 站 | 抖音收藏夹批量抓取（76 视频实测）；B 站 CC 字幕自动摄入 |
| Analyzer | 🧠 双 AI 路由 + 共识仲裁 | 豆包 + Kimi 真实实现；AnalyzerRouter 提供 sequential + consensus 双模式（consensus 字段级投票，置信度 + 冲突明细） |
| Builder | KnowledgeBuilder | 8 类自动分类（防漏兜底）+ Levenshtein 去重（阈值 0.6） |
| Sink | Markdown / Obsidian / 🟪 乐享 / Notion | Markdown 含 frontmatter + wikilinks；Obsidian 含 Vault 结构；乐享走 WorkBuddy MCP |
| Checkpoint | SQLite | 断点续传：跑 76 视频中途崩了下次自动从断点继续（Phase A Task 1） |
| 自适应限流 | Token Bucket + 5xx/CAPTCHA 退避 | 实测能稳定跑 1000+ 视频不触发风控（Phase A Task 5） |
| 结构化日志 | pino + requestId | 每条记录可按 batch / videoId / analyzer 追溯（Phase A Task 3） |

### 🟡 渐进交付中（已在路上，扩展期陆续上线）

| 模块 | 进度 |
|------|------|
| Collector 评论抓取 | 已用，分析阶段再补一次保证覆盖 |
| Obsidian Dataview 查询 | 生成 Dataview 友好的 frontmatter |
| 并行模式 + 共识仲裁 | AnalyzerRouter.routeConsensus 同跑多 AI，字段级投票合并，标 confidence + conflicts（Round 18 L1） |

### 🔮 下一阶段重点（**Phase B 推进**）

| 模块 | 备注 |
|------|------|
| 🇨🇳 B 站 Collector 增强 | 弹幕/分P/UP主信息处理 |
| 🌍 YouTube Collector | CC 字幕 + Chapters + 长视频分段 |
| Gemini / Claude Analyzer | 路由已搭好，配置增强中（沿用 BaseAnalyzer 框架） |
| 并行共识 + 字段置信度 | 基于现有多 AI 路由的仲裁层 |
| 知识图谱 / Web UI | Phase C |

### 🔮 远期想法

| 方向 | 描述 |
|------|------|
| 🇨🇳 小红书 | 图文笔记适配 |
| 插件市场 | 第三方 Adapter/Analyzer/Sink |
| 云端部署（可选） | 自托管服务 |

> 详见 [ROADMAP.md](ROADMAP.md) 看完整规划，[docs/STATUS.md](docs/STATUS.md) 看每项的真实状态。

## 🗺️ Roadmap（简版，详情见 [ROADMAP.md](ROADMAP.md)）

### Phase A: 固本（当前阶段）

- [x] **Task 5**: 响应式 rate limiting — `src/core/rate-limiter.mjs`（29 单测通过）
- [ ] **Task 1**: SQLite checkpoint 断点续传
- [ ] **Task 2**: 采集层 selector 视觉 fallback（截图+OCR）
- [ ] **Task 3**: pino/winston 结构化日志 + requestId
- [ ] **Task 4**: .env + zod 配置校验
- [ ] **Task 6**: 修复"其他"分类 bug（`keywords: []` 永远 false）
- [ ] **Task 7**: 核心路径测试（mock analyze → build → markdown）
- [ ] **Task 8**: 豆包结构化 JSON 输出 + 正则降级

### Phase B: 增效

- [ ] Kimi / Gemini / Claude Analyzer
- [ ] B 站 / YouTube Collector
- [ ] 任务优先级队列 + 动态并发
- [ ] 第二个 AI 交叉验证 + 字段置信度评分

### Phase C: 做深

- [ ] 多级标签（领域→技术→工具）
- [ ] 知识图谱（邻接表/图数据库 + 可执行学习路径）
- [ ] 本地 Web UI（搜索 + 技能地图）

### Phase D: 开源

- [ ] .github/workflows CI
- [ ] CONTRIBUTING.md
- [ ] npm 发布

## 📁 项目结构

```
videomind/
├── src/
│   ├── core/
│   │   ├── web-agent.mjs      # 浏览器自动化核心
│   │   ├── orchestrator.mjs   # 编排调度（串行/并行）
│   │   └── schema.mjs         # 统一数据模型
│   ├── collectors/
│   │   ├── douyin.mjs         # 抖音（已验证：防下载绕过+标签+评论）
│   │   └── bilibili.mjs       # B站（规划：弹幕+分P）
│   │   └── youtube.mjs        # YouTube（规划：CC字幕+Chapters）
│   ├── analyzers/
│   │   ├── doubao.mjs         # 豆包 Web-SubAgent（已验证）
│   │   ├── kimi.mjs           # Kimi（规划）
│   │   └── gemini.mjs         # Gemini（规划）
│   │   └── claude.mjs         # Claude（规划）
│   ├── builders/
│   │   └── knowledge-builder.mjs  # 分类+去重+技能图谱
│   ├── sinks/
│   │   ├── markdown.mjs       # Markdown 输出
│   │   └── lexiang.mjs        # 乐享 Connector
│   └── cli.mjs                # 命令行入口
├── docs/
│   ├── architecture.md        # 架构详解
│   └── zero-cost-guide.md     # 零成本原理
├── package.json
├── LICENSE
└── README.md
```

## ⚠️ 负责使用

- 仅用于个人学习研究，不对平台造成负担
- 控制请求频率（建议每个视频间隔 5-10 秒）
- 不存储原视频文件，仅存储链接和结构化摘要
- 遵守各平台使用条款和 ToS
- 遇到验证码时停止自动化，人工处理

## 🤝 Contributing

欢迎贡献新的 Adapter、Analyzer 或 Sink！请参考 `docs/architecture.md` 了解接口规范。

1. Fork → Branch → Commit → PR
2. 新增平台 Adapter：实现 `collect(collectionName)` 方法
3. 新增 Analyzer：实现 `analyze(video, attachments)` 方法
4. 新增 Sink：实现 `sink(knowledgeBase)` 方法

## 📜 License

[MIT](LICENSE) — 自由使用、修改、分发。

---

<a id="english"></a>

## 🎯 One-Line Pitch

Turn your Douyin/Bilibili/YouTube video favorites into a searchable, linkable, reusable knowledge base — **at zero API cost** — by letting a local Agent orchestrate browser automation to feed videos to free web-based multimodal AI (Doubao, Kimi, Gemini, Claude).

## 🤔 Why This Project

Your favorites are gathering dust.

- You saved hundreds of tutorial videos, but never systematically watched them
- You want to learn AI / coding / design, but don't know where to start
- Watching them all would take dozens of hours

**The traditional approach has fatal flaws:**

| Step | Problem |
|------|---------|
| Download videos | Douyin has **download protection** — many videos can't be saved locally |
| Transcribe audio | Whisper requires GPU; cloud APIs charge per minute |
| Analyze content | GPT-4o Vision etc. are **rate-limited + pay-per-call**, $1-5 for 100 videos |
| Organize into KB | Manual classification and summarization is painfully slow |

**VideoMind's solution: No downloads, no paid APIs, zero cost, full pipeline.**

You're already logged into Douyin and Doubao/Kimi/Gemini in your browser. Let the Agent automate browser interactions to feed video info directly to these **free web AIs** — they can understand videos, read comments, summarize content, with no rate limits and zero cost.

## 🏆 Verified Results

| Metric | Value |
|--------|-------|
| Douyin "skills" collection scraped | **76 videos** |
| Doubao deep analysis | **77/76 = 100% coverage** (49 deep + 28 enhanced basic) |
| Comments extracted | 71 |
| Speech-to-text obtained | 69 |
| Auto-categorized | 8 categories |
| Synced to Lexiang KB | 6 pages |
| **Total API cost** | **$0** |

> ⚠️ 100% coverage: all 76 videos were analyzed — 49 with 10-dimension deep structured output, 28 with enhanced basic analysis (comments + transcript + tags). **No video was skipped.**

## 💡 Zero Cost Principle

| Approach | Cost for 100 videos | Limitation |
|----------|-------------------|------------|
| GPT-4o Vision API | $1-5 | Rate-limited + pay-per-call |
| Gemini Pro Vision API | $0.5-2 | Rate-limited + requires API key |
| Local Whisper + LLaVA | GPU cost | Needs GPU + slow transcription |
| Download → Transcribe → API | Videos may be un-downloadable | Douyin download protection |
| **VideoMind (web AI)** | **$0** | **No rate limits · No downloads needed** |

**How?**

1. **No video downloads** — Douyin blocks downloads. VideoMind operates inside the browser, just like a human watching the video.
2. **Reuse your logged-in browser** — Chrome CDP :9222 connects to your real browser session.
3. **Leverage free web AI tiers** — Doubao/Kimi/Gemini/Claude all offer free web usage with no rate limits. Playwright automates them as callable SubAgents.
4. **Local Agent only orchestrates** — Task planning, prompt assembly, result merging — deep reasoning goes to free Web AI.

## 🚀 Quick Start

```bash
git clone https://github.com/HU1234top/videomind.git
cd videomind && npm install

# Start Chrome with remote debugging
chrome --remote-debugging-port=9222

# Collect → Analyze → Build → Sync
node src/cli.mjs collect --platform douyin --collection skills
node src/cli.mjs analyze --analyzer doubao
node src/cli.mjs build
node src/cli.mjs sync --sink markdown
```

## 📊 Skill-Focused Analysis Framework (10 Dimensions)

Each video is analyzed as a **learnable skill unit**, not just summarized:

| # | Dimension | Description | Example |
|---|-----------|-------------|---------|
| 1 | **Skill Name** | What specific skill the video teaches | "Claude 10x Learning Method" / "Firecrawl Free Scraping" |
| 2 | **Skill Level** | Beginner/Intermediate/Advanced/Expert | 5-tier scale |
| 3 | **Key Points** | 3-5 must-remember takeaways | "6-step learning loop", "80/20 core focus" |
| 4 | **Action Steps** | Follow-along step-by-step instructions | Step 1 → Step 2 → ... |
| 5 | **Tools/Resources** | Specific tools or websites mentioned | AgentChat / Firecrawl / Claude |
| 6 | **Pitfalls** | Common mistakes the author warns about | "Don't use Claude as search engine" |
| 7 | **Use Cases** | When to apply this skill | AI automation / web data collection |
| 8 | **Prerequisites** | What you need to know first | Basic Python / Agent architecture |
| 9 | **Learning Path** | Which videos to combine for best results | "Watch #3 first → then #7" |
| 10 | **Auto Tags** | Machine-generated classification tags | `#AI-Agent` `#Scraper` `#OpenSource` |

## 🎯 Douyin-Specific Capabilities

### Bypass Download Protection
Douyin videos have anti-download mechanisms. VideoMind **doesn't download** — it lets the web AI "watch" the video directly in the browser, exactly like a human would.

### Tag/Topic Extraction
Douyin videos come with `#AI` `#Coding` `#OpenSource` topic tags. VideoMind auto-extracts these as initial classification input, then refines with AI analysis.

### Comment Harvesting
Douyin comments often contain user feedback, supplementary explanations, and even author replies. VideoMind grabs the top N comments as auxiliary analysis material — one comment can be more valuable than the video title.

### Speech Understanding
Web AIs like Doubao can directly understand video speech content, no local Whisper transcription needed.

## 🔌 Support Matrix

### Video Platforms (Collector)

| Platform | Special Features | Status |
|----------|-----------------|--------|
| Douyin | Download bypass + Tags + Comments | ✅ MVP verified (76 videos) |
| Bilibili | Danmaku + Multi-part + UP info | 📋 Phase 2 |
| YouTube | CC subtitles + Chapters + Long video | 📋 Phase 2 |
| Xiaohongshu | Image-text notes + Tags | 🔮 Future |

### Web AI (Analyzer)

| AI | Strengths | Cost | Rate Limit | Status |
|----|-----------|------|------------|--------|
| Doubao | Chinese understanding, skill analysis | Free | None | ✅ Verified |
| Kimi | Long context, deep reading | Free | None | 📋 Phase 2 |
| Gemini | Multimodal, English | Free | Limited | 📋 Phase 2 |
| Claude | Structured output, code logic | Free tier | Limited | 📋 Phase 2 |

### Knowledge Base (Sink)

| KB | Status |
|----|--------|
| Lexiang | ✅ 6 pages synced |
| Markdown | ✅ Implemented |
| Obsidian | ✅ Basic |
| Notion | 📋 Phase 3 |

## 🗺️ Roadmap

- **Phase 1 ✅** — Douyin collector (download bypass) + Doubao analyzer (skill-focused 10-dim) + Knowledge builder + Markdown/Lexiang sink
- **Phase 2 📋** — Bilibili/YouTube adapters + Kimi/Gemini/Claude analyzers + Parallel mode
- **Phase 3 📋** — Knowledge graph visualization + Notion/Obsidian connectors + Local Web UI
- **Phase 4 🔮** — Plugin marketplace + Cloud deployment (optional)

## ⚠️ Responsible Use

- Personal learning only; don't overload platforms
- Rate-limit requests (5-10s per video)
- Store only links and summaries, never original video files
- Stop automation on CAPTCHA; handle manually
- Respect platform ToS

## 📜 License

[MIT](LICENSE)
