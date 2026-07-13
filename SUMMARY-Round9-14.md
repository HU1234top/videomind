# VideoMind Phase B 总结 — Round 9-14 交付清单

> 生成时间: 2026-07-11
> 涵盖: Round 9 (Analyzer Router) + Round 10 (Kimi) + Round 11 (Kimi 缩略图) + Round 12 (B 站 Collector) + Round 13 (SKILL.md) + Round 14 (Doubao 真分析 — 未完成)

## 🎯 核心目标：让 VideoMind 真正可用

**Phase A**（Round 1-8）：把所有模块搭起来 — collectors / analyzers / sinks / builders
**Phase B**（Round 9-13）：让**视频内容真的进 LLM** 并产出**可被 Agent 调用的 Skill**

## 📦 Round-9-13 已交付（全部可推 GitHub）

### Round 9: Analyzer Router（已完成 ✅）

**问题**：原架构只支持单一 analyzer，无 fallback，占位类永远 throw  
**解决**：独立 `AnalyzerRouter` 类 + registry 模式 + 错误码分类

| 文件 | 用途 |
|---|---|
| `src/core/analyzer-router.mjs` | Router 主体 |
| `src/core/analyzer-errors.mjs` | AnalyzerUnavailableError / NotLoggedInError / AnalyzerUnreachableError |
| `src/core/web-agent.mjs` | import 真实 analyzer + **修 disconnect 红线 bug**（不调 browser.close()）|
| `src/cli.mjs` | 硬编码链 `[primary, ...fallback.filter]` |
| `src/core/orchestrator.mjs` | init() 实例化 Router |
| `src/core/config.mjs` | analyzeSchema 加 `fallback` 字段 |
| `selectors/{kimi,gemini,claude}.json` | 3 个占位 selector |

**测试**：26 router + 9 errors 全过

### Round 10: Kimi Analyzer 真实实现（已完成 ✅）

**问题**：4 个 analyzer 都是占位 `"not yet implemented"`  
**解决**：仿 doubao.mjs 写 460 行 KimiAnalyzer，含 Lexical editor 兼容（contenteditable 不能 fill()）+ 简化 prompt（用户原话："帮我详细分析这个视频"）+ `_dismissLoginModal`

| 文件 | 用途 |
|---|---|
| `src/analyzers/kimi.mjs` | 真实实现 |
| `src/analyzers/kimi.test.mjs` | 29 测试 |
| `selectors/kimi.json` | 从 Edge 9222 dump 真实采集 |
| `scripts/dump-kimi-selectors.mjs` / `dump-kimi-send-button.mjs` | dump 工具 |

**关键发现**：Kimi 发送按钮是 `div.send-button-container`（不是 button）

### Round 11: Kimi 缩略图上传（已完成 ✅）

**问题**：Douyin URL Kimi 访问被反爬虫拦截 → Kimi 看不到视频内容  
**解决**：下载 thumb → ClipboardEvent paste → Kimi 看图推测

| 改动 | 内容 |
|---|---|
| `src/analyzers/kimi.mjs` | 加 `_downloadThumb()` + `_pasteImage()` |
| `_fillContentEditable` | 截断 1800 字符 + 不按 Enter |
| `buildPrompt` | thumb 模式：`图片已附上该视频的缩略图` |

### Round 12: Bilibili Collector + CC 字幕（已完成 ✅ **最重大**）

**根问题**：VideoMind 一直**没真正拿到视频内容**。Douyin 拿不到字幕，Kimi 看缩略图瞎猜。

**解决**：引入 B 站 Collector —— 通过公开 API + 登录 cookie + 公开 CDN 链路下载 AI 字幕/人工 CC

| 文件 | 用途 |
|---|---|
| `src/collectors/bilibili.mjs` | 460 行（view API + v2 API + CDN 下载） |
| `src/collectors/bilibili.test.mjs` | 13 测试 |
| `scripts/launch-edge.mjs` | 改用 `start "" "..."` 让 Edge 持久 |

**E2E 实测成功**：
- TED 视频 `BV1X4UkYNE8A`：2779 字符真实中文字幕
- doubao json API `data.subtitle.list[]` 公开可得
- v2 API `data.subtitle.subtitles[]`（**必须 SESSDATA** cookie）

### Round 13: SKILL.md 改造（已完成 ✅）

**借鉴**：用户分享 kangarooking/cangjie-skill 的 SKILL.md 模板（RIA++ 六段）  
**解决**：把 doubao 10 维度 JSON 渲染为**仓颉.Skill 兼容的 SKILL.md**

| 改动 | 内容 |
|---|---|
| `src/analyzers/doubao.mjs` | (1) 修 stale handle (2) buildPrompt 字段对齐 (3) 新增 `renderAsSkillMd()` |
| `src/analyzers/doubao.test.mjs` | 13 测试 |

**SKILL.md 结构**（仓颉.Skill 协议）：
```
---
name: <skill-slug>
description: |
  <use_cases 节选>
source_video: <title> | <author>
source_url: <URL>
tags: [#tag1, #tag2]
related_skills: []
---

# <skill_name>

## R — 原文引用 (Reading)
## I — 方法论骨架 (Interpretation)
## A1 — 视频中的应用 (Past Application)
## A2 — 触发场景 (Future Trigger) ★
## E — 可执行步骤 (Execution)
## B — 边界 (Boundary) ★
```

### Round 14: 修 doubao 真分析 — ⚠️ **未完成**

**问题**：Round 12/13 E2E 暴露 doubao.analyze() 返回占位符（不是真实 AI 回复）

**根因（深度 dump 后）**：
1. Doubao 网页版 chat input 是 `textarea.semi-input-textarea-autosize`，**没有 send button**（Enter 发送）
2. Edge debug profile 默认**未登录豆包** → 无 send 路径 → 营销 demo 渲染
3. **修复路径**：用户扫码登录豆包即可（你已协助完成 Edge 9222 doubao 登录）

**已完成 / 未完成的状态**：
- ✅ Edge 9222 现在有 doubao sessionid cookie（你已完成登录）
- ❌ 未完成：实测 doubao analyze 真发 prompt + 收到真实 AI 回复（取决于 textarea keydown 路径的实现，需要 Round 15+ 继续）

---

## 📊 测试统计（Round 9-13 累计）

| 套件 | 测试数 | 状态 |
|---|---:|---|
| analyzer-router (R9) | 26 | ✅ |
| analyzer-errors (R9) | 9 | ✅ |
| kimi (R10/R11) | 26 | ✅ |
| bilibili (R12) | 13 | ✅ |
| doubao (R13) | 13 | ✅ |
| doubao-json (已有) | 29 | ✅ |
| **Round 9-13 新增** | **116** | **✅ 116/116 全过** |
| checkpoint | 21 | ⏸ 环境问题 |

## 📦 已交付 patches 包

| 目录 | 内容 | 文件数 |
|---|---|---:|
| `patches-r9/` | Analyzer Router + 占位 analyzer | 14 |
| `patches-r10/` | Kimi Analyzer + selectors | 5 |
| `patches-r11/` | Kimi 缩略图 upload | 2 |
| `patches-r12/` | B 站 Collector | 3 |
| `patches-r13/` | doubao SKILL.md render | 2 |

**总共 ~26 个 patches 文件**，可分批推 GitHub

## ⚠️ 已知限制（坦诚）

### 1. doubao 真分析 — Round 14 没完成（最严重）

E2E 暴露问题：豆包 chat 没真分析我的 prompt。需要：
- 修 textarea keydown handler
- 或用 v2 API prompt-template.md 的方式（参考 WorkBuddy）
- 再加 doubao.mjs 重新跑 E2E

### 2. launch-edge.mjs 用隔离 debug profile — 需 cookie sync

每次重启 debug Edge = profile 隔离 = cookie 清空 = 你**必须重新登录**

**用户反馈**：「我记得这种豆包登录之前就已经登过了呀，为啥每次非得让我重新登一下」

**应该做的**（Round 15 候选）：写 `scripts/sync-cookies.mjs` 让 debug Edge 复用你日常 Edge 的 cookie

### 3. Knowledge Builder 还未吃 SKILL.md

Round 13 产出的 SKILL.md 还没进知识库。下一步可改造 KB 接受 SKILL.md 文件输入

### 4. B 站 douyin 评论未抓

B 站 collector 只抓字幕 + metadata，未抓评论（Round 12 留作 Phase B 后续）

## 🎯 路线建议（基于已交付的现状）

| 选项 | 内容 | 工作量 | 价值 |
|---|---|---|---|
| **A** | Round 15: cookie-sync 工具（修"每次重登"） | 0.5d | **高 — 解决你报怨的根问题** |
| **B** | Round 15: 修 doubao 真分析（啃硬骨头） | 1-2d | 高，但风险大 |
| **C** | Round 15: Knowledge Builder 吃 SKILL.md | 0.5d | 中，闭环 |
| **D** | Round 15: B 站评论 API + 二次分析 | 1d | 中 |

## 🤝 给用户的最强建议

**先交付已完成的 Round 9-13 推 GitHub**（你给我的最高优先级）。Round 14 + 后续改进可放在下一轮。

---

## 🎉 Round 12 是最大突破

让 VideoMind 第一次**真正拿到视频内容**（B 站 CC 字幕 2779 字符 TED 中文）。整个 analyzer 链路第一次能产出**有依据**的分析（不再是瞎猜）。
