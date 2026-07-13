/**
 * VideoMind Core — Analyzer Router (Phase B Task 1)
 *
 * 借鉴 AgentChat 多模型路由 + runtime-org/runtime Skill 声明式模式。
 *
 * 核心职责：
 *   1. 持有 registry（analyzer 类映射）+ chain（[primary, ...fallback]）
 *   2. 顺序尝试 chain 中的每个 analyzer
 *   3. 错误分类：UNAVAILABLE/NOT_LOGGED_IN → skip；CAPTCHA → abort；其他 → fallback
 *   4. checkpoint 集成：成功 markCompleted，失败 markFailed
 *   5. 全失败 → AnalyzerUnreachableError
 *
 * 设计原则：
 *   - Router 不持有业务状态（每次 route() 独立）
 *   - 错误码分类是 Router 的核心价值
 *   - 占位 analyzer 抛 AnalyzerUnavailableError 被自动 skip，无需特殊处理
 *   - NotLoggedInError 留给后续 doubao analyzer 集成（本轮不动 doubao.mjs）
 */

import { createLogger } from './logger.mjs';
import { arbitrate } from './consensus.mjs';
import {
  AnalyzerUnavailableError,
  NotLoggedInError,
  AnalyzerUnreachableError
} from './analyzer-errors.mjs';

/**
 * 错误分类结果
 *   skip   - 立刻跳过此 analyzer，尝试下一个（UNAVAILABLE / NOT_LOGGED_IN）
 *   fallback - 继续尝试下一个 analyzer（普通错误）
 *   abort  - 立刻终止 chain，不再 fallback（CAPTCHA_DETECTED 等致命错误）
 */
function classify(err) {
  if (err instanceof AnalyzerUnavailableError) return { action: 'skip', reason: 'analyzer unavailable' };
  if (err instanceof NotLoggedInError) return { action: 'skip', reason: 'user not logged in' };
  if (err?.code === 'UNAVAILABLE') return { action: 'skip', reason: 'analyzer unavailable' };
  if (err?.code === 'NOT_LOGGED_IN') return { action: 'skip', reason: 'user not logged in' };
  if (err?.code === 'CAPTCHA_DETECTED') return { action: 'abort', reason: 'captcha detected' };
  return { action: 'fallback', reason: 'transient error' };
}

export class AnalyzerRouter {
  /**
   * @param {Object} options
   * @param {Object} options.registry - { doubao: Class, kimi: Class, ... }
   * @param {string} options.primary - primary analyzer name
   * @param {string[]} options.fallback - fallback chain (excluding primary)
   * @param {Object} options.context - playwright browser context
   * @param {Object} [options.logger] - pino logger (default: createLogger)
   * @param {Object} [options.checkpoint] - Checkpoint instance (optional)
   */
  constructor(options) {
    if (!options?.registry) throw new Error('AnalyzerRouter: registry is required');
    if (!options.primary) throw new Error('AnalyzerRouter: primary is required');

    this.registry = options.registry;
    this.context = options.context;
    this.logger = options.logger || createLogger({ base: { component: 'router' } });
    this.checkpoint = options.checkpoint || null;

    // 去重 chain: 保持顺序，去掉所有重复项（primary + fallback 内部重复都处理）
    const seen = new Set();
    const ordered = [options.primary, ...(options.fallback || [])];
    this._chain = ordered.filter(n => {
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
  }

  /**
   * 返回有序 chain: [primary, ...fallback excluding primary]
   * 缓存结果（不变）。
   */
  get chain() {
    return [...this._chain];
  }

  /**
   * 路由一个 video 到合适的 analyzer
   *
   * @param {Object} video - { url, title, author, tags, comments, transcript }
   * @param {Array} [attachments=[]] - 截图等附加数据
   * @returns {Promise<Object>} analyzer result（含 .analysis, .dimensions 等）
   * @throws {AnalyzerUnreachableError} 所有 analyzer 都失败
   * @throws {Error} CAPTCHA 等致命错误立即抛
   */
  async route(video, attachments = []) {
    if (!video?.url) throw new Error('AnalyzerRouter.route: video.url is required');

    const attempts = [];

    for (const name of this._chain) {
      const AnalyzerClass = this.registry[name];
      if (!AnalyzerClass) {
        this.logger.warn?.({ stage: 'route', analyzer: name }, 'analyzer not registered, skipping');
        attempts.push({ name, error: { code: 'NOT_REGISTERED', message: 'analyzer not in registry' } });
        continue;
      }

      // checkpoint 短路：已完成 → 返回缓存
      if (this.checkpoint?.isCompleted?.(video.url)) {
        const cached = this.checkpoint.getCachedResult?.(video.url);
        if (cached) {
          this.logger.info?.({ stage: 'route', url: video.url, title: video.title?.substring(0, 30) }, 'skipped (cached)');
          return cached;
        }
      }

      // markInProgress（如果 checkpoint 配置了）
      if (this.checkpoint?.markInProgress) {
        const accepted = this.checkpoint.markInProgress(video.url);
        if (!accepted) {
          this.logger.warn?.({ stage: 'route', url: video.url, analyzer: name }, 'max retries exceeded, skipping');
          attempts.push({ name, error: { code: 'MAX_RETRIES', message: 'checkpoint rejected' } });
          continue;
        }
      }

      // 实例化 + 调用
      let analyzer;
      try {
        analyzer = new AnalyzerClass(this.context, {
          logger: this.logger.child?.({ analyzer: name }) || this.logger
        });
        const result = await analyzer.analyze(video, attachments);

        if (result && result.analysis) {
          if (this.checkpoint?.markCompleted) this.checkpoint.markCompleted(video.url, result);
          this.logger.info?.(
            { stage: 'route', url: video.url, analyzer: name, title: video.title?.substring(0, 30) },
            'analyzed'
          );
          return result;
        }
        // analyzer 返回但 .analysis 为空 → 视为失败
        attempts.push({ name, error: { code: 'EMPTY_RESULT', message: 'analyzer returned no analysis' } });
      } catch (err) {
        const cls = classify(err);
        attempts.push({ name, error: err });
        this.logger.warn?.(
          {
            stage: 'route',
            url: video.url,
            analyzer: name,
            code: err?.code,
            msg: err?.message,
            action: cls.action
          },
          'analyzer failed'
        );

        if (cls.action === 'abort') {
          // 致命错误（CAPTCHA）→ 立即终止，不再 fallback
          if (this.checkpoint?.markFailed) this.checkpoint.markFailed(video.url, err.message);
          throw err;
        }
        // skip / fallback → 继续循环
      }
    }

    // 全部失败
    if (this.checkpoint?.markFailed) this.checkpoint.markFailed(video.url, 'all analyzers failed');
    this.logger.error?.({ stage: 'route', url: video.url, attempts: attempts.length }, 'all analyzers failed');
    throw new AnalyzerUnreachableError(video.url, attempts);
  }

  /**
   * 暴露分类函数（便于测试 + 未来扩展）
   */
  static classify(err) {
    return classify(err);
  }

  /**
   * Round 18 / L1 — 并行共识仲裁路由.
   *
   * 跟 route() 不同: 同时跑 chain 里所有 analyzer, 字段级投票合并.
   *
   * @param {Object} video
   * @param {Array} [attachments=[]]
   * @returns {Promise<Object>} { result, consensus } (consensus 来自 arbitrate)
   *
   * 行为:
   *   - 全部 ≥2 个 analyzer 成功 → arbitrate()
   *   - 只有 1 个成功 → wrap single-result (mode='single-result')
   *   - 全部失败 → AnalyzerUnreachableError
   *
   * 失败处理:
   *   - NotLoggedInError / UNAVAILABLE 该 analyzer 视为"无响应", 仍进入 consensus.failed
   *   - CAPTCHA 等致命 → abort 全 chain
   */
  async routeConsensus(video, attachments = []) {
    if (!video?.url) throw new Error('AnalyzerRouter.routeConsensus: video.url is required');

    const responses = [];
    let abortErr = null;

    for (const name of this._chain) {
      const AnalyzerClass = this.registry[name];
      if (!AnalyzerClass) {
        responses.push({ analyzer: name, result: null, error: new Error('not registered') });
        continue;
      }

      let analyzer;
      try {
        analyzer = new AnalyzerClass(this.context, {
          logger: this.logger.child?.({ analyzer: name, mode: 'consensus' }) || this.logger
        });
        const result = await analyzer.analyze(video, attachments);
        if (result && result.analysis) {
          responses.push({ analyzer: name, result });
          this.logger.info?.({ stage: 'routeConsensus', url: video.url, analyzer: name }, 'analyzed');
        } else {
          responses.push({ analyzer: name, result: null, error: new Error('empty result') });
        }
      } catch (err) {
        const cls = classify(err);
        this.logger.warn?.({ stage: 'routeConsensus', url: video.url, analyzer: name, code: err?.code, action: cls.action }, 'analyzer failed');
        responses.push({ analyzer: name, result: null, error: err });

        if (cls.action === 'abort') {
          abortErr = err;
          break;
        }
        // skip / fallback → 继续跑下一个
      }
    }

    if (abortErr) throw abortErr;

    // checkpoint 缓存 (consensus 的最终 result)
    const arbitrated = arbitrate(responses, { primary: this._chain[0] });
    if (this.checkpoint?.markCompleted) {
      this.checkpoint.markCompleted(video.url, arbitrated.result);
    }
    this.logger.info?.(
      { stage: 'routeConsensus', url: video.url, confidence: arbitrated.consensus.confidence, mode: arbitrated.consensus.mode },
      'consensus complete'
    );
    return arbitrated;
  }
}