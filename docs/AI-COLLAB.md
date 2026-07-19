# AI 协作规范（VideoMind）

> 本文档是 **SeniorDeveloper（门禁/审查/提交）** 与 **Cloud code / MiniMax M3（功能实现）**
> 之间的同步契约。两个 AI 都读 GitHub 仓库，本文是唯一能对齐的媒介。
> 每次大改动后由 SeniorDeveloper 更新本文件，避免"你俩信息不一致"。

---

## 1. 角色分工

| 角色 | 职责 | 红线 |
|------|------|------|
| **SeniorDeveloper** | 审查 MiniMax 产出、合并到 `videomind-github`、跑测试、commit + push、修 bug、架构决策 | 修改代码必须加 `SeniorDeveloper:` 注释标记；绝不 `browser.close()`（会杀掉用户真实浏览器） |
| **Cloud code / MiniMax M3** | 按需求实现功能（新 Analyzer / Collector / Sink） | 复用 `BaseAnalyzer`，**不要重复造轮子**；新文件直接写 workspace，不要打补丁包 |

---

## 2. 🔑 共享模式：网页 AI 文本抓取 + JSON 解析（最重要）

**问题**：豆包 / Kimi 这类网页 AI 的输出不是干净 JSON——可能带 markdown 代码块、前后多余文字、或不输出 JSON 只给自然语言。Cloud code 在此反复卡住。

**解决方案已存在于 `src/core/base-analyzer.mjs`，复用即可，禁止各自实现**：

```js
// 三段降级解析（已验证 100+ 视频）
class BaseAnalyzer {
  parseResponse(video, rawText) {
    const json = this.tryParseJSON(rawText);          // 1. 直接 2. ```json 代码块 3. 平衡花括号
    return json ? this.buildResultFromJSON(...)        // → 结构化 10 维
                : this.buildResultFromRegex(...);       // → 正则降级（保底不丢数据）
  }
}

// 新增 analyzer 只需：
class MyAnalyzer extends BaseAnalyzer {
  async _doAnalyze(video) { /* 平台特有 UI 交互，抓到原始文本 responseText */ }
  buildPrompt(video) { /* 10 维 JSON 指令 */ }
}
// 解析、retry、limiter、selector 加载全在基类，不用碰。
```

**关键 API**：
- `tryParseJSON(text)` → 三段降级（直接 / code block / 平衡花括号 `extractBalancedJSON`）
- `parseResponse(video, rawText)` → 自动选 JSON 或正则降级，返回 `{ url, title, dimensions, parseMode, ... }`
- 抓文本时：**绝不要假设输出是纯 JSON**。先 `waitForElementTextStable` 等文本稳定，再整段传给 `parseResponse`。

---

## 3. 错误分类（Router 靠它做开关）

`src/core/analyzer-errors.mjs` 定义错误类，Router 据此 `skip / fallback / abort`：

| 错误类 | code | Router 行为 | 何时抛 |
|--------|------|------------|--------|
| `AnalyzerUnavailableError` | `UNAVAILABLE` | skip | 占位 / 未实现（如 gemini/claude stub） |
| `NotLoggedInError` | `NOT_LOGGED_IN` | skip | 检测到登录按钮（见 doubao `_checkLoginState`） |
| `AnalyzerUnreachableError` | `UNREACHABLE` | 全失败 | chain 跑完都失败 |

⚠️ **致命错误** `CAPTCHA_DETECTED` → `abort`（立刻停，不要再 fallback 触发更多风控）。
抛错时务必 `e.code = '...'` 或继承对应类，否则 Router 当普通错误走 fallback。

---

## 4. 新增一个 Analyzer 的标准姿势（避免再踩坑）

```js
import { BaseAnalyzer } from '../core/base-analyzer.mjs';
import { waitForElement, captureFailure } from '../core/selector.mjs'; // ← 必须 import！子类作用域拿不到基类的

export class XxxAnalyzer extends BaseAnalyzer {
  constructor(ctx, opts = {}) {
    super(ctx, { platform: 'xxx', ...opts });
    this.url = 'https://xxx.com';
  }
  async _doAnalyze(video) {
    const page = await this.context.newPage();
    try {
      await page.goto(this.url, { waitUntil: 'domcontentloaded' });
      const input = await waitForElement(page, this.selectors.chatInput, { intervals: [3000,5000] });
      if (!input.element) throw new Error('chat input not found');
      // ... 填 prompt、发、等回复 ...
      return this.parseResponse(video, responseText);
    } catch (e) {
      await captureFailure(page, 'analyze-failed', { logger: this.logger });
      throw e;
    } finally { await page.close(); }
  }
  buildPrompt(video) { /* 10 维 JSON 指令 */ }
}
```

⚠️ **已知回归（SeniorDeveloper 修过）**：`waitForElement` / `captureFailure` 必须在子类里自己 import，
基类 import 了不代表子类能用。漏 import 会在真实运行（非单测）时 `ReferenceError`。

---

## 5. 开关模式（AnalyzerRouter）现状

- ✅ `sequential`：primary + fallback chain，错误分类驱动 skip/fallback/abort，checkpoint 短路。
- ⚠️ `parallel`：**半残**——`analyzeParallel` 绕过 Router 直接 `sendToAI`，`arbitrate()` 硬编码选豆包。
  仅当 2+ 真实 analyzer 实现后才有意义（当前 gemini/claude 仍是 stub）。
- ⚠️ fallback chain 写死在 `orchestrator.mjs`（`['doubao','kimi','gemini','claude']`），CLI 还不能配置顺序。

---

## 6. 测试与提交

- 跑测试：`node --test src/**/*.test.mjs`
- checkpoint 相关 15~16 个测试在沙箱环境因 `better-sqlite3` 原生模块失败，**非代码 bug**，真实环境通过。
- 提交信息格式：`fix(round-N): ...` / `feat(...): ...`，SeniorDeveloper 修改加 `SeniorDeveloper:` 前缀注释。
- 推送：需用户开加速器；推送后清理 remote URL 里的 token（`git remote set-url origin https://github.com/HU1234top/videomind.git`）。
