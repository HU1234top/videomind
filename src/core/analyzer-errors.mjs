/**
 * VideoMind Core — Analyzer Error Classes
 *
 * Round 9: 定义 Router 用来分类错误的错误类型。
 *
 * 设计原则：
 *   - 错误码 (code) 决定 Router 的 action: skip / fallback / abort
 *   - 每种错误都带 analyzer 名字（用于日志）
 *   - 都继承自标准 Error，可被 try/catch 正常捕获
 *
 * 错误码矩阵（对应 Router._classify）：
 *   'UNAVAILABLE'     → skip（占位 analyzer / 明确声明不可用）
 *   'NOT_LOGGED_IN'   → skip（需要用户人工介入，登录后再试）
 *   'CAPTCHA_DETECTED'→ abort（验证码，不要继续 fallback 以免触发更多风控）
 *   其他              → fallback（继续尝试下一个 analyzer）
 */

/**
 * AnalyzerUnavailableError — analyzer 明确声明不可用
 *
 * 用法：占位 analyzer（kimi/gemini/claude 尚未实现）抛此错误。
 * Router 收到后立即 skip，不计入"真失败"。
 */
export class AnalyzerUnavailableError extends Error {
  constructor(name, reason) {
    super(`Analyzer '${name}' unavailable: ${reason}`);
    this.name = 'AnalyzerUnavailableError';
    this.code = 'UNAVAILABLE';
    this.analyzer = name;
  }
}

/**
 * NotLoggedInError — 用户未登录到该网页 AI
 *
 * 用法：analyzer 探测到登录态缺失时抛此错误（如豆包登录按钮可见）。
 * Router 收到后立即 skip 到下一个 analyzer（fallback 设计初衷）。
 *
 * evidence: 探测到的 UI 证据（如 "login button visible" + 截图路径），方便用户排查。
 */
export class NotLoggedInError extends Error {
  constructor(name, evidence) {
    super(`Analyzer '${name}' requires user login: ${evidence}`);
    this.name = 'NotLoggedInError';
    this.code = 'NOT_LOGGED_IN';
    this.analyzer = name;
    this.evidence = evidence;
  }
}

/**
 * AnalyzerUnreachableError — 所有 analyzer 都失败
 *
 * 用法：Router 在 chain 跑完后所有 analyzer 都失败时抛此错误。
 * attempts 数组记录每个 analyzer 的尝试结果（含 error code/message）。
 */
export class AnalyzerUnreachableError extends Error {
  constructor(videoUrl, attempts) {
    const summary = (attempts || [])
      .map(a => `${a.name}=${a.error?.code || 'UNKNOWN'}(${a.error?.message || ''})`)
      .join(', ');
    super(`All analyzers failed for ${videoUrl} after ${attempts?.length || 0} attempts: ${summary}`);
    this.name = 'AnalyzerUnreachableError';
    this.code = 'UNREACHABLE';
    this.videoUrl = videoUrl;
    this.attempts = attempts || [];
  }
}