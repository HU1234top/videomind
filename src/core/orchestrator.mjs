/**
 * VideoMind Orchestrator — Task planning, routing, and coordination
 *
 * Key fix: unified analyzer.analyze(video, options) signature.
 * Previous version had mismatched args (content vs video) between
 * Orchestrator → WebAgent → DoubaoAnalyzer, causing semantic confusion
 * and lost attachments.
 */

import { WebAgent, AnalyzerFactory } from './web-agent.mjs';
import { SUPPORTED_ANALYZERS } from './schema.mjs';

export class Orchestrator {
  constructor(options = {}) {
    this.agent = new WebAgent({ cdpPort: options.cdpPort || 9222 });
    this.mode = options.mode || 'sequential';
    this.primaryAnalyzer = options.primaryAnalyzer || 'doubao';
    // Only include actually-implemented analyzers in fallback chain
    this.fallbackChain = options.fallbackChain || ['doubao'];
    this.maxRetries = options.maxRetries || 3;
    // Optional checkpoint for resume-on-failure (Phase A Task 1)
    this.checkpoint = options.checkpoint || null;
  }

  async init() {
    await this.agent.connect();
    return this;
  }

  /**
   * Decide analysis strategy for a batch of videos.
   *
   * Fixed logic: sequential is the safe default for large batches,
   * parallel only for small/high-priority batches with multiple
   * *implemented* analyzers available.
   */
  decideStrategy(videos, options = {}) {
    const count = videos.length;
    const priority = options.priority || 'normal';
    const implementedAnalyzers = ['doubao']; // Only actually working analyzers

    if (priority === 'high' && count <= 10 && implementedAnalyzers.length >= 2) {
      return { mode: 'parallel', analyzers: implementedAnalyzers.slice(0, 2) };
    }
    return { mode: 'sequential', primary: this.primaryAnalyzer, fallback: this.fallbackChain };
  }

  /**
   * Sequential mode: primary analyzer with retry + fallback.
   * Only falls back to actually-implemented analyzers.
   */
  async analyzeSequential(video, primaryAnalyzer, fallbackChain) {
    // Resume: skip if checkpoint says already done
    if (this.checkpoint && this.checkpoint.isCompleted(video.url)) {
      const cached = this.checkpoint.getCachedResult(video.url);
      if (cached) {
        console.log(`[VideoMind] ✓ Skipped (cached): "${video.title?.substring(0, 30)}"`);
        return cached;
      }
    }

    const chain = fallbackChain || this.fallbackChain;
    for (const analyzerName of chain) {
      // Mark in_progress (increments attempts, gates max retries)
      if (this.checkpoint) {
        const accepted = this.checkpoint.markInProgress(video.url);
        if (!accepted) {
          throw new Error(`Max retries exceeded for video: ${video.title}`);
        }
      }

      let lastError;
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          const result = await this.agent.sendToAI(analyzerName, video, {
            attempt,
            maxRetries: this.maxRetries,
          });
          if (result && result.analysis) {
            if (this.checkpoint) this.checkpoint.markCompleted(video.url, result);
            return result;
          }
        } catch (e) {
          lastError = e;
          console.log(`[VideoMind] ${analyzerName} attempt ${attempt} failed for "${video.title?.substring(0, 30)}": ${e.message}`);
          if (attempt < this.maxRetries) {
            // Exponential backoff: 2s, 4s, 8s
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }
      console.log(`[VideoMind] ${analyzerName} exhausted retries, trying next analyzer...`);
    }

    if (this.checkpoint) this.checkpoint.markFailed(video.url, 'all analyzers failed');
    throw new Error(`All analyzers failed for video: ${video.title}`);
  }

  /**
   * Parallel mode: multiple analyzers run simultaneously.
   * Currently only Doubao is implemented, so this effectively
   * runs as single-analyzer until Phase 2 adds Kimi/Gemini/Claude.
   */
  async analyzeParallel(video, analyzers) {
    const implemented = analyzers.filter(a => a === 'doubao');
    if (implemented.length === 0) {
      throw new Error('No implemented analyzers available for parallel mode');
    }

    const results = await Promise.allSettled(
      implemented.map(a => this.agent.sendToAI(a, video))
    );

    const successful = results
      .filter(r => r.status === 'fulfilled' && r.value?.analysis)
      .map(r => r.value);

    if (successful.length === 0) throw new Error('All parallel analyzers failed');
    if (successful.length === 1) return successful[0];

    return this.arbitrate(successful);
  }

  /**
   * Arbitration: pick the best result from multiple analyzers.
   *
   * Current: prefer Doubao for Chinese content (it's the only
   * implemented analyzer anyway). Phase 2 will add:
   * - LLM-as-Judge quality scoring
   * - Weighted voting by dimension confidence
   * - Cross-validation between analyzers
   */
  arbitrate(results) {
    const doubaoResult = results.find(r => r.analyzer === 'doubao');
    return doubaoResult || results[0];
  }

  async shutdown() {
    await this.agent.disconnect();
  }
}
