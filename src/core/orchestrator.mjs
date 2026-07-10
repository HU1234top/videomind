/**
 * VideoMind Orchestrator — Task planning, routing, and coordination
 */

import { WebAgent, AnalyzerFactory } from '../core/web-agent.mjs';
import { SUPPORTED_ANALYZERS } from '../core/schema.mjs';
import { createLogger } from './logger.mjs';

export class Orchestrator {
  constructor(options = {}) {
    this.agent = new WebAgent({ cdpPort: options.cdpPort || 9222 });
    this.mode = options.mode || 'sequential';  // 'sequential' or 'parallel'
    this.primaryAnalyzer = options.primaryAnalyzer || 'doubao';
    this.fallbackChain = options.fallbackChain || ['doubao', 'kimi', 'gemini', 'claude'];
    // Optional checkpoint for resume-on-failure (Phase A Task 1)
    this.checkpoint = options.checkpoint || null;
    this.logger = options.logger || createLogger({ base: { component: 'orchestrator' } });
  }

  async init() {
    await this.agent.connect();
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
   * Checkpoint integration (Phase A Task 1):
   * - Skip videos already completed (return cached result)
   * - Record in_progress / completed / failed transitions
   */
  async analyzeSequential(video, primaryAnalyzer, fallbackChain) {
    // Resume: skip if checkpoint says already done
    if (this.checkpoint && this.checkpoint.isCompleted(video.url)) {
      const cached = this.checkpoint.getCachedResult(video.url);
      if (cached) {
        this.logger.info({ stage: 'analyze', url: video.url, title: video.title?.substring(0, 30) }, 'skipped (cached)');
        return cached;
      }
    }

    for (const analyzer of fallbackChain) {
      // Mark in_progress (increments attempts, gates max retries)
      if (this.checkpoint) {
        const accepted = this.checkpoint.markInProgress(video.url);
        if (!accepted) {
          this.logger.warn({ stage: 'analyze', url: video.url, title: video.title }, 'max retries exceeded, skipping');
          throw new Error(`Max retries exceeded for video: ${video.title}`);
        }
      }

      try {
        const result = await this.agent.sendToAI(analyzer, video);
        if (result && result.analysis) {
          if (this.checkpoint) this.checkpoint.markCompleted(video.url, result);
          this.logger.info({ stage: 'analyze', url: video.url, analyzer, title: video.title?.substring(0, 30) }, 'analyzed');
          return result;
        }
      } catch (e) {
        this.logger.warn({ stage: 'analyze', url: video.url, analyzer, err: e.message, title: video.title?.substring(0, 30) }, 'analyzer failed, trying next');
        continue;
      }
    }

    if (this.checkpoint) this.checkpoint.markFailed(video.url, 'all analyzers failed');
    this.logger.error({ stage: 'analyze', url: video.url, title: video.title }, 'all analyzers failed');
    throw new Error(`All analyzers failed for video: ${video.title}`);
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
