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

<a id="中文"></a>

## 🎯 一句话定位

把抖音/B站/YouTube 收藏夹里的视频，**零 API 成本**自动交给网页版多模态 AI（豆包、Kimi、Gemini、Claude 等）分析理解，最终沉淀为可检索、可关联、可复用的结构化知识库。

## 🏆 已验证成果

> 不是PPT，不是假设——这是真实跑出来的数据。

| 指标 | 数值 |
|------|------|
| 抖音收藏夹视频抓取 | **76 个视频** |
| 豆包深度分析（10维度） | **49 个** |
| 含评论数据 | 71 个 |
| 含语音转文字 | 69 个 |
| 自动分类 | **8 个类别** |
| 乐享知识库入库 | **6 篇文档** |
| **总成本** | **$0** |

## 🤔 为什么做这个项目

你的收藏夹在吃灰吗？

- 抖音/B站收藏了几百个视频，但从来没系统看过
- 想学 AI / 编程 / 设计，收藏了一大堆教程，不知道从哪开始
- 视频太多，逐个看要花几十个小时
- 下载视频贵、转录音频贵、分析内容更贵

**VideoMind 把这三步全自动化了：采集 → 分析 → 入库，且零 API 成本。**

## 🏗️ 核心架构

```
Local Agent (编排调度)
    │
    ▼
Collector: 抖音/B站/YouTube Adapter
    │         Playwright + Chrome CDP :9222
    ▼
决策: 任务可拆分?
   │              │
串行模式          并行模式
(主力+Fallback)   (多模型共识仲裁)
   │              │
    └────────────┘
         │
         ▼
Analyzer: 豆包/Kimi/Gemini/Claude Web-SubAgent
         │
         ▼
Builder: 去重/标签(8类)/知识点/知识图谱
         │
         ▼
Sink: 乐享/Notion/Obsidian/Markdown
```

## 💡 零成本原理

| 方案 | 100视频成本 |
|------|-----------|
| OpenAI GPT-4o Vision API | $1-5 |
| Google Gemini API | $0.5-2 |
| 本地 Whisper + 视觉模型 | GPU 费用 |
| **VideoMind** | **$0** |

**怎么做到零成本的？**

1. **复用你已登录的浏览器** — Chrome CDP :9222 连接真实浏览器，跳过登录和 Cookie
2. **利用网页版免费额度** — 豆包/Kimi/Gemini/Claude 都有网页端免费额度，Playwright 自动化操作 = 免费调用多模态能力
3. **本地 Agent 只做调度** — 规划任务、组装 prompt、合并结果，深度推理全交给免费 Web AI

> 借鉴了 [AgentChat](https://github.com/) 的 Web-SubAgent 思想，但垂直聚焦于「视频 → 知识库」场景。

## 🚀 快速开始

### 前置要求

- Node.js >= 18
- Chrome / Edge 浏览器（已登录目标平台）
- 已登录豆包/Kimi 等网页 AI 账号

### 安装

```bash
git clone https://github.com/jiayi-hu/videomind.git
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
# 1. 采集抖音收藏夹
node src/cli.mjs collect --platform douyin --collection skills

# 2. 用豆包分析所有视频（串行模式）
node src/cli.mjs analyze --analyzer doubao

# 3. 构建知识库
node src/cli.mjs build

# 4. 输出为 Markdown
node src/cli.mjs sync --sink markdown
```

## 📊 10维度分析框架

每个视频经过深度分析后输出 10 个维度：

| # | 维度 | 说明 |
|---|------|------|
| 1 | summary | 一段话概括 |
| 2 | key_points | 核心要点列表 |
| 3 | tags | 自动标签 |
| 4 | actionable_items | 可行动项 |
| 5 | target_audience | 目标受众 |
| 6 | related_topics | 相关话题 |
| 7 | difficulty_level | 隯度等级 |
| 8 | core_concepts | 核心概念 |
| 9 | practical_examples | 实操案例 |
| 10 | learning_path | 学习路径建议 |

## 🔌 支持矩阵

### 视频平台（Collector）

| 平台 | 状态 |
|------|------|
| 🇨🇳 抖音 | ✅ MVP 已验证（76视频） |
| 🇨🇳 B站 | 📋 Phase 2 |
| 🌍 YouTube | 📋 Phase 2 |
| 🇨🇳 小红书 | 🔮 未来 |

### 网页 AI（Analyzer）

| AI | 擅长 | 成本 | 状态 |
|----|------|------|------|
| 豆包 | 中文理解、视觉分析 | 免费 | ✅ 已验证 |
| Kimi | 长文本、超长上下文 | 免费 | 📋 Phase 2 |
| Gemini | 多模态推理 | 免费 | 📋 Phase 2 |
| Claude | 结构化输出 | 免费额度 | 📋 Phase 2 |

### 知识库（Sink）

| 知识库 | 状态 |
|--------|------|
| 乐享知识库 | ✅ 已入库6篇 |
| 本地 Markdown | ✅ 已实现 |
| Obsidian | ✅ 基础版 |
| Notion | 📋 Phase 3 |

## 🗺️ Roadmap

### Phase 1: MVP ✅
- [x] 抖音收藏夹视频抓取
- [x] 豆包网页端10维度分析
- [x] 自动8类分类 + 知识库构建
- [x] 乐享知识库入库
- [x] 本地 Markdown 输出

### Phase 2: 多平台 + 多Analyzer（进行中）
- [ ] B站收藏夹 Adapter
- [ ] Kimi / Gemini / Claude Analyzer
- [ ] Analyzer Router（自动选择最合适的 AI）
- [ ] 并行模式 + 共识仲裁

### Phase 3: 知识库产品化
- [ ] 统一知识 Schema v2
- [ ] 知识图谱可视化
- [ ] Notion / Obsidian Connector
- [ ] 本地 Web UI（搜索、复习）

### Phase 4: 社区生态
- [ ] 插件市场：更多平台 Adapter
- [ ] 更多 Analyzer / Sink
- [ ] 云端部署方案（可选）

## 📁 项目结构

```
videomind/
├── src/
│   ├── core/
│   │   ├── web-agent.mjs      # 浏览器自动化核心
│   │   ├── orchestrator.mjs   # 编排调度（串行/并行）
│   │   └── schema.mjs         # 统一数据模型
│   ├── collectors/
│   │   ├── douyin.mjs         # 抖音收藏夹抓取
│   │   └── bilibili.mjs       # B站（规划中）
│   │   └── youtube.mjs        # YouTube（规划中）
│   ├── analyzers/
│   │   ├── doubao.mjs         # 豆包 Web-SubAgent
│   │   ├── kimi.mjs           # Kimi（规划中）
│   │   └── gemini.mjs         # Gemini（规划中）
│   │   └── claude.mjs         # Claude（规划中）
│   ├── builders/
│   │   └── knowledge-builder.mjs  # 分类+去重+图谱
│   ├── sinks/
│   │   ├── markdown.mjs       # Markdown 输出
│   │   └── lexiang.mjs        # 乐享 Connector（规划中）
│   └── cli.mjs                # 命令行入口
├── docs/
│   └── architecture.md
│   └── zero-cost-guide.md
├── examples/
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

## 🏆 Verified Results

| Metric | Value |
|--------|-------|
| Douyin favorites scraped | **76 videos** |
| Doubao deep analysis (10-dim) | **49** |
| With comments | 71 |
| With transcripts | 69 |
| Auto-categorized | **8 categories** |
| Synced to Lexiang KB | **6 pages** |
| **Total cost** | **$0** |

> These are real production numbers from a 2026-07-09 run on the "skills" Douyin collection. Not simulated.

## 💡 How Zero Cost Works

1. **Reuse your logged-in browser** — Chrome CDP :9222 connects to your real browser session
2. **Leverage free web AI tiers** — Doubao/Kimi/Gemini/Claude all offer free web usage; Playwright automates them as callable SubAgents
3. **Local Agent only orchestrates** — Task planning, prompt assembly, result merging — deep reasoning goes to free Web AI

| Approach | Cost for 100 videos |
|----------|-------------------|
| GPT-4o Vision API | $1–5 |
| Gemini API (paid) | $0.5–2 |
| Local Whisper + Vision | GPU cost |
| **VideoMind** | **$0** |

## 🚀 Quick Start

```bash
git clone https://github.com/jiayi-hu/videomind.git
cd videomind && npm install

# Start Chrome with remote debugging
chrome --remote-debugging-port=9222

# Collect → Analyze → Build → Sync
node src/cli.mjs collect --platform douyin --collection skills
node src/cli.mjs analyze --analyzer doubao
node src/cli.mjs build
node src/cli.mjs sync --sink markdown
```

## 🗺️ Roadmap

- **Phase 1 ✅** — Douyin collector + Doubao analyzer + Knowledge builder + Markdown/Lexiang sink
- **Phase 2 📋** — Bilibili/YouTube adapters + Kimi/Gemini/Claude analyzers + Parallel mode
- **Phase 3 📋** — Knowledge graph visualization + Notion/Obsidian connectors + Local Web UI
- **Phase 4 🔮** — Plugin marketplace + Cloud deployment (optional)

## ⚠️ Responsible Use

- Personal learning only; don't overload platforms
- Rate-limit requests (5–10s per video)
- Store only links and summaries, never original video files
- Stop automation on CAPTCHA; handle manually
- Respect platform ToS

## 📜 License

[MIT](LICENSE)
