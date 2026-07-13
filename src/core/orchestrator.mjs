/**
 * VideoMind Orchestrator — Task planning, routing, and coordination
 *
 * Round 9 改造:
 *   - 引入 AnalyzerRouter 替代 analyzeSequential 内的内联 fallback 循环
 *   - Router 统一处理 UNAVAILABLE / NOT_LOGGED_IN / CAPTCHA 错误分类
 *   - checkpoint 集成：Router 自己 markCompleted/markFailed
 */

import { WebAgent, AnalyzerFactory } from '../core/web-agent.mjs';
import { AnalyzerRouter } from './analyzer-router.mjs';
import { SUPPORTED_ANALYZERS } from '../core/schema.mjs';
import { createLogger } from './logger.mjs';

export class Orchestrator {
  constructor(options = {}) {
    this.agent = new WebAgent({ cdpPort: options.cdpPort || 9222, logger: options.logger });
    this.mode = options.mode || 'sequential';  // 'sequential' or 'parallel'
    this.primaryAnalyzer = options.primaryAnalyzer || 'doubao';
    this.fallbackChain = options.fallbackChain || ['doubao', 'kimi'];
    // Optional checkpoint for resume-on-failure (Phase A Task 1)
    this.checkpoint = options.checkpoint || null;
    this.logger = options.logger || createLogger({ base: { component: 'orchestrator' } });
    this.router = null;  // lazy in init()
  }

  async init() {
    await this.agent.connect();
    // 初始化 Router（构造 + 注入）
    this.router = new AnalyzerRouter({
      registry: AnalyzerFactory.all(),
      primary: this.primaryAnalyzer,
      fallback: this.fallbackChain,
      context: this.agent.context,
      logger: this.logger,
      checkpoint: this.checkpoint
    });
    return this;
  }

  /**
   * Decide analysis strategy for a batch of videos
   * - Sequential: one primary AI + fallback chain (fast, efficient)
   * - Parallel: 3+ AI analyze simultaneously + consensus arbitration (accurate)
   */
  decideStrategy(videos, options = {}) {
    const count = videos.length;
    const priority = options.priority || 'normal';

    if (priority === 'high' || count <= 10) {
      return { mode: 'parallel', analyzers: this.fallbackChain.slice(0, 3) };
    }
    return { mode: 'sequential', primary: this.primaryAnalyzer, fallback: this.fallbackChain };
  }

  /**
   * Sequential mode: primary AI does deep analysis, fallback on failure.
   *
   * Round 9 改造: 委托给 AnalyzerRouter 处理错误分类 + chain 遍历。
   * 保留 checkpoint "isCompleted → 返回缓存" 的语义。
   */
  async analyzeSequential(video /* primary, fallback 都被 router 持有 */) {
    if (!this.router) {
      throw new Error('Orchestrator: init() must be called before analyzeSequential');
    }
    return this.router.route(video);
  }

  /**
   * Parallel mode: multiple AI analyze simultaneously, consensus arbitration
   */
  async analyzeParallel(video, analyzers) {
    const results = await Promise.allSettled(
      analyzers.map(a => this.agent.sendToAI(a, video))
    );

    const successful = results
      .filter(r => r.status === 'fulfilled' && r.value?.analysis)
      .map(r => r.value);

    if (successful.length === 0) throw new Error(`All parallel analyzers failed`);
    if (successful.length === 1) return successful[0];

    // Consensus arbitration: merge/vote on best result
    return this.arbitrate(successful);
  }

  arbitrate(results) {
    // Simple arbitration: prefer Doubao for Chinese content
    // Full implementation would use LLM-as-Judge or weighted voting
    const doubaoResult = results.find(r => r.platform === 'doubao');
    return doubaoResult || results[0];
  }

  async shutdown() {
    await this.agent.disconnect();
  }
}
