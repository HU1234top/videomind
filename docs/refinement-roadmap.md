# VideoMind 完善路线图：从 MVP 到生产可用

> 基于当前 `videomind` 已验证的「抖音收藏 → 豆包分析 → 知识库」MVP，针对健壮性、并发效率、知识库深度、输出质量、工程规范、平台适配六个维度给出可落地的改进方案。
>
> **2026-07-09 更新**：已执行第二轮代码审查修复（13 个 P0-P3 bug），详见 docs/STATUS.md。

---

## 一、核心判断

当前 VideoMind 的**价值已被验证**：
- 76 个抖音视频 100% 被分析
- 零 API 成本
- 10 维度技能拆解框架有效

但代码层面仍是 **MVP + 大量 Phase 2/3 规划**。要开源并可持续运行，必须先把「能跑一次」升级为「能反复跑、能容错、能扩展」。

改进总纲：**先固本（健壮性 + 工程规范），再增效（并发 + 多模型），最后做深（知识图谱 + 学习路径）**。

---

## 二、六大问题域与具体对策

### 2.1 健壮性：从「裸奔脚本」到「可容错采集」

当前问题：CDP 连接真实浏览器，浏览器崩溃、页面跳转、抖音反爬、UI 变更都没有容错。

#### 具体改造

| 组件 | 现状 | 目标 | 关键技术 |
|------|------|------|----------|
| 浏览器连接 | 直接 `connectOverCDP` | 连接池 + 健康检查 | 启动前 `fetch('http://localhost:9222/json/version')`；失败则提示用户启动 Chrome |
| 页面导航 | 单次 `goto` | 重试 + 超时降级 | 指数退避 3 次，超时 30s |
| 元素定位 | 硬编码 selector | selector + 视觉/文本 fallback | Playwright `getByText` / `getByRole` / 截图 OCR 定位 |
| 反爬风控 | 无 | 限流 + 人机验证中断 | 每视频 5-15s 随机间隔；遇到验证码/登录框暂停并通知用户 |
| 适配器维护 | 一个文件写死 | 版本化 adapter + 快照测试 | `adapters/douyin/v1.ts`，记录 DOM 快照用于回归 |

#### 关键代码结构

```ts
// src/core/resilient-browser.ts
export class ResilientBrowser {
  async ensureConnected(endpoint: string, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const version = await fetch(`${endpoint}/json/version`).then(r => r.json());
        return await chromium.connectOverCDP(endpoint);
      } catch (e) {
        await sleep(1000 * 2 ** i);
      }
    }
    throw new BrowserConnectionError('请先用 chrome --remote-debugging-port=9222 启动浏览器');
  }
}

// src/core/element-locator.ts
export async function robustClick(page: Page, spec: ElementSpec) {
  const strategies = [
    () => page.locator(spec.selector).click(),
    () => page.getByText(spec.text).click(),
    () => page.getByRole(spec.role, { name: spec.name }).click(),
    () => visualLocateAndClick(page, spec.description), // 截图 + AI 定位
  ];
  for (const strategy of strategies) {
    try { return await strategy(); } catch { continue; }
  }
  throw new ElementNotFoundError(spec);
}
```

#### 建议的熔断策略

- 连续 3 次同类型错误 → 熔断该 adapter 5 分钟
- 检测到登录页/验证码 → 立即停止，记录任务状态，等人工处理
- 浏览器 disconnected → 自动重连，保留任务队列

---

### 2.2 并发与效率：从「串行喂视频」到「限流感知的调度器」

当前问题：一个一个喂给豆包，77 个视频耗时不可控；失败没有断点续传。

#### 目标设计

- **状态持久化**：SQLite 记录每个视频的状态（pending / collecting / analyzing / completed / failed）
- **断点续传**：重启后读取未完成任务继续跑
- **限流感知**：根据平台响应动态调整并发
- **优先级队列**：重要的/短的视频先跑

#### 调度器接口

```ts
// src/core/scheduler.ts
export interface Task {
  id: string;
  videoUrl: string;
  status: TaskStatus;
  priority: number;
  retryCount: number;
  lastError?: string;
  checkpoint?: Checkpoint;
}

export class VideoScheduler {
  async enqueue(videos: VideoMeta[], mode: 'sequential' | 'parallel') {}
  async run(options: { maxConcurrency: number; delayRange: [number, number] }) {}
  async resume() {} // 断点续传
}
```

#### 并发策略

| 场景 | 模式 | 并发数 | 间隔 |
|------|------|--------|------|
| 日常批量 | 串行 + fallback | 1 | 8-12s |
| 关键视频 | 并行共识 | 2-3 | 10-15s |
| 平台响应慢/风控 | 自动降级 | 1 | 15-30s |

**注意**：免费 Web AI 也会限流，并行反而可能更快触发风控。所以并行模式必须带「限流感知退让」。

---

### 2.3 知识库构建：从「8 类摘要」到「可执行知识图谱」

当前问题：8 类太粗；知识图谱只存在于 README；技能关联只是文字建议。

#### 升级方向

1. **多级标签体系**
   - L1 领域：AI Agent / 编程 / 设计 / 产品 / 效率
   - L2 主题：Agent框架 / RAG / MCP / 浏览器自动化 / VibeCoding
   - L3 具体技能：Claude Code / Playwright / OpenClaw / Codex
   - L4 视频本身：技能单元

2. **知识图谱实体化**
   - 节点类型：`Skill`、`Tool`、`Concept`、`Project`、`Person`、`Video`
   - 边类型：`teaches`、`requires`、`uses`、`related_to`、`prerequisite_of`
   - 存储：JSON-LD 或 SQLite，最终可视化用 D3 / Cytoscape.js

3. **学习路径可执行**
   - 基于 `prerequisite_of` 边生成拓扑排序
   - 输出「学习路线图」：先看 A → 再看 B → 最后 C

#### Schema v2 示例

```json
{
  "video_id": "v_7658411673698457834",
  "title": "AgentChat Skill 开源",
  "skill": {
    "name": "Web-SubAgent 低成本调用网页 AI",
    "level": "intermediate",
    "domain": ["AI Agent", "浏览器自动化"],
    "topics": ["SubAgent", "Playwright", "CDP"]
  },
  "knowledge_graph": {
    "nodes": [
      { "id": "web-subagent", "type": "concept", "name": "Web-SubAgent" },
      { "id": "playwright-cdp", "type": "tool", "name": "Playwright + CDP" },
      { "id": "agentchat", "type": "project", "name": "AgentChat" }
    ],
    "edges": [
      { "from": "web-subagent", "to": "playwright-cdp", "relation": "uses" },
      { "from": "agentchat", "to": "web-subagent", "relation": "implements" }
    ]
  },
  "learning_path": {
    "prerequisites": ["agent-basics"],
    "next": ["mcp-protocol", "browser-automation"]
  }
}
```

---

### 2.4 输出质量：从「一次生成」到「交叉验证 + 质量评分」

当前问题：10 维度分析全靠豆包一次输出，无校验、无去重、无评分。

#### 三层质量保障

| 层级 | 机制 | 目的 |
|------|------|------|
| L1 自校验 | Analyzer 输出 JSON Schema 校验 | 确保字段完整、格式正确 |
| L2 交叉验证 | 主 Analyzer + 审查 Analyzer | 对比两份输出，标记不一致 |
| L3 质量评分 | 基于规则 + AI 评分 | 给每个分析结果打 0-100 分 |

#### 评分维度

- **完整性**：10 维度是否都填了
- **一致性**：标题、摘要、标签是否自洽
- **可执行性**：实操步骤是否具体
- **可信度**：是否包含来源引用或数据
- **去重度**：与已有视频的技能重合度

#### 审查 Prompt 示例

```
你是一名严格的内容审查员。请审查以下 AI 对视频的分析结果，指出：
1. 是否有明显事实错误？
2. 是否有遗漏的关键技能点？
3. 实操步骤是否可执行？
4. 给整体质量打分（0-100）并说明理由。
```

---

### 2.5 工程规范：从「脚本集合」到「可维护项目」

当前问题：无测试、无 CI/CD、无 .env、错误吞掉、日志非结构化。

#### 必须补齐的清单

- [ ] `.env.example` + `src/config.ts` 配置校验（zod）
- [ ] 结构化日志：pino 或 winston，每条日志带 `taskId`、`videoId`、`adapter`、`analyzer`
- [ ] 错误码体系：`ERR_BROWSER_DISCONNECTED`、`ERR_ELEMENT_NOT_FOUND`、`ERR_ANALYZER_RATE_LIMIT` 等
- [ ] 单元测试：Jest/Vitest 测试纯函数（schema 解析、去重、标签提取）
- [ ] 集成测试：用 Playwright 的 mock 模式或本地 HTML fixture 测试 adapter
- [ ] GitHub Actions CI：lint → test → build → typecheck
- [ ] TypeScript 严格模式
- [ ] Prettier + ESLint

#### 推荐目录结构补充

```
videomind-github/
├── .env.example
├── .github/workflows/ci.yml
├── src/
│   ├── config.ts           # 配置校验
│   ├── errors/             # 错误码
│   ├── logger.ts           # 结构化日志
│   ├── core/               # 浏览器、调度、状态
│   ├── collectors/
│   ├── analyzers/
│   ├── builders/
│   ├── sinks/
│   └── cli.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/           # 本地 HTML 快照
└── package.json
```

---

### 2.6 平台适配：从「乐观规划」到「接口标准化 + 分阶段落地」

当前问题：README 看起来多平台多模型全搞定，实际只有抖音 + 豆包。

#### 接口契约

所有 adapter / analyzer / sink 必须实现统一接口：

```ts
// src/interfaces.ts
export interface ICollector {
  readonly name: string;
  readonly version: string;
  collect(collectionName: string): AsyncGenerator<VideoMeta>;
  healthCheck(): Promise<boolean>;
}

export interface IAnalyzer {
  readonly name: string;
  analyze(video: VideoMeta, context: AnalysisContext): Promise<AnalysisResult>;
}

export interface ISink {
  readonly name: string;
  sink(knowledgeBase: KnowledgeBase): Promise<void>;
}
```

#### README 诚实标注

| 平台/AI | 状态 | 说明 |
|---------|------|------|
| 抖音 + 豆包 | ✅ 已验证 | 76 视频真实跑通 |
| B站 | 🧪 实验性 | 需验证弹幕抓取与登录态 |
| YouTube | 📋 规划中 | 接口已设计，未实现 |
| Kimi/Gemini/Claude | 📋 规划中 | Analyzer 接口已统一 |

**原则**：不夸大已完成的功能，每个组件标注 `verified` / `experimental` / `planned`。

---

## 三、Roadmap（推荐执行顺序）

### Phase A：固本（2-3 周）

- [ ] 接入 SQLite 状态库 + 断点续传
- [ ] Collector 增加重试、熔断、视觉 fallback
- [ ] 统一配置校验 + 结构化日志
- [ ] 错误码体系 + 人机验证中断
- [ ] 单元测试覆盖核心函数
- [ ] README 诚实标注各组件状态

**交付标准**：77 个视频重新跑一遍，中途故意 kill 进程后能 100% 恢复继续。

### Phase B：增效（2-3 周）

- [ ] 限流感知的任务调度器（串行/并行可切换）
- [ ] Kimi / Gemini / Claude Analyzer 实现
- [ ] Analyzer Router + Fallback 链
- [ ] 交叉验证机制（主分析 + 审查）
- [ ] 输出质量评分

**交付标准**：单个视频有主分析 + 审查分数；失败自动换模型重试。

### Phase C：做深（3-4 周）

- [ ] Schema v2：多级标签 + 知识图谱
- [ ] 去重合并（语义 + 技能重合度）
- [ ] 学习路径生成（拓扑排序）
- [ ] 本地 Web UI：搜索、浏览、技能地图
- [ ] Notion / Obsidian Sink 完善

**交付标准**：输出一本可点击、有图谱、有学习路径的「AI Agent 技能手册」。

### Phase D：开源打磨（持续）

- [ ] 中英文 README 完善
- [ ] 60 秒 DEMO 视频
- [ ] GitHub Actions CI/CD
- [ ] 贡献指南 + Adapter/Analyzer/Sink 开发模板
- [ ] 发布到 npm：`npx videomind`

---

## 四、关键架构决策

### 4.1 为什么优先做状态持久化？

因为 Web AI 不稳定、平台反爬不可预测。**没有状态持久化，所有并发、多模型、断点续传都无从谈起**。SQLite 足够轻量，不需要额外服务。

### 4.2 为什么先串行再并行？

免费 Web AI 的限流策略不透明，盲目并行会更快触发风控。正确的顺序是：
1. 先让串行模式稳定可靠
2. 再对「关键视频」开并行共识
3. 根据实际限流反馈动态调整

### 4.3 知识图谱为什么不用大库？

初期节点数量少（几百个视频），JSON-LD + 内存计算足够。等节点过万再考虑 Neo4j 等图数据库。保持 Local-First。

### 4.4 视觉定位 fallback 的成本

视觉定位需要额外截图 + 让 AI 找坐标，会增加 token/时间。应作为 selector 失效后的兜底，非常规路径。

---

## 五、立即可做的 5 件事

如果你现在只有 1 小时，按这个顺序做：

1. **加 SQLite 状态表**（30 分钟）：
   ```sql
   CREATE TABLE tasks (
     id TEXT PRIMARY KEY,
     video_url TEXT,
     status TEXT,
     retry_count INTEGER DEFAULT 0,
     last_error TEXT,
     result_json TEXT,
     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
   );
   ```

2. **加 `.env.example`**（10 分钟）：
   ```
   CHROME_CDP_ENDPOINT=http://localhost:9222
   DEFAULT_ANALYZER=doubao
   RATE_LIMIT_DELAY_MS=8000
   MAX_RETRIES=3
   LOG_LEVEL=info
   ```

3. **把硬编码 selector 抽到 config**（15 分钟）：
   ```ts
   export const DOUYIN_SELECTORS = {
     collectionTab: '[data-e2e="collection-tab"]',
     videoLink: 'a[href*="/video/"]',
   };
   ```

4. **加一个重试包装函数**（15 分钟）：
   ```ts
   export async function withRetry<T>(fn: () => Promise<T>, retries = 3) {
     for (let i = 0; i < retries; i++) {
       try { return await fn(); }
       catch (e) { if (i === retries - 1) throw e; await sleep(1000 * 2 ** i); }
     }
   }
   ```

5. **改 README 的状态标注**（10 分钟）：把 B站/YouTube/Kimi/Gemini/Claude 从 ✅ 改成 📋 或 🧪。

---

## 六、总结

VideoMind 的**方向很有价值**，但开源前必须把基础打牢：

- **不要急着加平台**，先把抖音 + 豆包这条链路做到「能反复跑、能断点续传、能自动容错」
- **不要急着并行**，先把串行调度做稳，再逐步放开并发
- **不要夸大功能**，README 里明确哪些是 verified、哪些是 planned
- **把知识库做深**，从「8 类摘要」升级到「知识图谱 + 学习路径」，这才是真正的差异化

完成 Phase A 后，这个项目就从「一次性的牛逼脚本」变成「可给别人用的开源工具」。
