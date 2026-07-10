# VideoMind 技术原理详解

## 为什么浏览器操作 + 网页 AI 交互能这么顺畅？

核心模式叫 **Web-SubAgent**（"浏览器即 API 网关"），这是 VideoMind 的创新点。

---

## 1. 浏览器操作的基础：CDP + Playwright

```
你的Chrome（已登录抖音/豆包）
    │  --remote-debugging-port=9222
    ▼
VideoMind → Playwright → CDP → 控制浏览器
```

### Chrome DevTools Protocol (CDP)
Chrome 原生暴露的调试协议，端口 9222。启动方式：

```cmd
chrome.exe --remote-debugging-port=9222
```

这相当于在浏览器旁边开了一个「远程控制接口」。任何工具都能通过 CDP：
- 打开/关闭标签页
- 点击、输入、滚动
- 读取 DOM 内容
- 截屏
- 获取网络请求

### Playwright
微软出品的浏览器自动化库。关键代码只有一行：

```javascript
const browser = await chromium.connectOverCDP(`http://localhost:9222`);
const context = browser.contexts()[0]; // 复用你已登录的浏览器上下文
```

**核心竞争力**：不重新启动浏览器，而是**连接到你已经打开并登录好的 Chrome**。这意味着：
- 抖音的登录态自动继承（不需要管理 Cookie）
- 豆包的登录态自动继承（不需要输入账号密码）
- 一切 CAPTCHA/验证码/滑块验证 都不需要额外处理

---

## 2. 与网页 AI 交互：把 AI 聊天页面变成 API

传统做法是调 OpenAI/Claude API，要花钱、要申请 Key。VideoMind 的做法是：

```
打开豆包网页 → 输入分析Prompt → 等待生成 → 提取回复 → 解析结果
```

### 步骤 A：输入 Prompt

```javascript
await page.goto('https://doubao.com');
await page.fill('.chat-input', prompt);  // 把视频信息填入聊天框
await page.press('Enter');
```

### 步骤 B：等待 AI 生成完成

```javascript
// 等"停止生成"按钮消失（代表生成完毕）
const stopBtn = page.locator('[data-e2e="stop-generating"]');
await stopBtn.waitFor({ state: 'hidden', timeout: 120000 });
```

### 步骤 C：提取 AI 回复

```javascript
const response = await page.locator('.assistant-message').last().textContent();
```

**完整流程 = 人类打开豆包做的事情，代码全部模拟了一遍。**

---

## 3. JSON 优先 + 正则降级

为了让解析更可靠，Prompt 末尾加了一段严格指令：

```
## 输出格式（严格 JSON）
请仅以一个合法的 JSON 对象回复，不要包含任何其他文字。
{"skill_name":"...", "skill_level":"...", "key_points":[...], ...}
```

解析器 `tryParseJSON` 三段兜底：

```
1. 直接 JSON.parse → 成功就用
2. 提取 ```json ... ``` 代码块 → 再解析
3. 找第一个平衡的 { ... } → 再解析
4. 全部失败 → 降级到正则提取（传统方式）
```

测试覆盖率：29 个用例覆盖了所有边缘情况。

---

## 4. 为什么选择这种方案？

| 对比项 | 传统 API 方案 | Web-SubAgent 方案 |
|--------|-------------|-----------------|
| 成本 | OpenAI $0.01-0.03/次 | **零成本**（只用已有豆包账号） |
| 门槛 | 需要 API Key + 绑信用卡 | 只需要一个浏览器 |
| 稳定性 | API 99.9% | 依赖网页 DOM 结构（脆弱性） |
| 速率限制 | API 有 TPM 限制 | 自适应限流器动态调整 |
| 支持模型 | 取决于付费 | 理论上任何网页 AI |

---

## 5. 完整流水线架构

```
┌─────────────────────────────────────────────────────────┐
│                 你的 Chrome (已登录)                      │
│  抖音 CDP:9222         豆包     Obsidian                 │
└────┬────────────────────┬────────────────────┬──────────┘
     │ connectOverCDP     │ 输入 Prompt         │ 生成 .md 文件
     ▼                    ▼                     ▼
┌──────────┐   ┌──────────────┐   ┌──────────────────┐
│ Collector │ → │  Analyzer    │ → │     Sink         │
│ 采集视频   │   │  AI 分析     │   │  输出到知识库     │
│ .video-   │   │ .assistant-  │   │ Obsidian/Markdown│
│ card      │   │ message      │   │                  │
└──────────┘   └──────────────┘   └──────────────────┘
     │               │                    │
     ▼               ▼                    ▼
video_list.json → analysis.json → 结构化知识库
```

---

## 6. 为什么这么顺畅？关键工程决策

1. **复用已登录浏览器**：不处理 Cookie/Token/验证码，直接挂在你现有的 Chrome 上
2. **自适应限流**：5 次成功 → 间隔缩小 10%；遇到 429/503 → 指数退避
3. **断点续传**：SQLite 记录每个视频的分析状态，崩溃了下次自动跳过已完成的
4. **配置校验**：zod 启动时校验参数，错误立刻报具体的字段路径
5. **结构化日志**：pino 输出 JSON 日志，每个请求带 requestId 可回溯

---

## 7. 当前能力边界

| 已验证 ✅ | 实验性 ⚠️ | 规划中 📋 |
|----------|-----------|----------|
| 抖音采集 | B站采集 | YouTube 采集 |
| 豆包 AI 分析 | Kimi/Gemini/Claude 分析 | 多模型交叉验证 |
| Markdown 输出 | Lexiang 知识库同步 | Obsidian 高级配置 |
| Obsidian Vault | Notion 同步 | Web UI |
| 断点续传 | | 知识图谱可视化 |

---

*想深入了解可以直接看 GitHub 仓库：https://github.com/HU1234top/videomind*
