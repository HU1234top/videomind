/**
 * VideoMind CLI — Command-line interface
 */

import { DouyinCollector } from './collectors/douyin.mjs';
import { DoubaoAnalyzer } from './analyzers/doubao.mjs';
import { KnowledgeBuilder } from './builders/knowledge-builder.mjs';
import { MarkdownSink } from './sinks/markdown.mjs';
import { Orchestrator } from './core/orchestrator.mjs';
import { getLimiter } from './core/rate-limiter.mjs';
import { createLogger } from './core/logger.mjs';
import { loadConfig, ConfigError, SUPPORTED_PLATFORMS, SUPPORTED_ANALYZERS, SUPPORTED_SINKS, SUPPORTED_MODES } from './core/config.mjs';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const command = args[0];
const logger = createLogger({ name: 'videomind', base: { component: 'cli' } });

async function main() {
  switch (command) {
    case 'collect':
      await runWithConfig('collect', collect);
      break;
    case 'analyze':
      await runWithConfig('analyze', analyze);
      break;
    case 'build':
      await runWithConfig('build', build);
      break;
    case 'sync':
      await runWithConfig('sync', sync);
      break;
    default:
      console.log(`
VideoMind CLI — Turn your video favorites into a knowledge base

Usage:
  node src/cli.mjs collect   --platform <platform> --collection <name>
  node src/cli.mjs analyze   --analyzer <analyzer>
  node src/cli.mjs build     --input <file>
  node src/cli.mjs sync      --sink <sink>

Options:
  --platform    ${SUPPORTED_PLATFORMS.join(' | ')} (default: douyin)
  --collection  Favorites collection name (default: skills)
  --analyzer    ${SUPPORTED_ANALYZERS.join(' | ')} (default: doubao)
  --sink        ${SUPPORTED_SINKS.join(' | ')} (default: markdown)
  --mode        ${SUPPORTED_MODES.join(' | ')} (default: sequential)
  --cdp-port    Chrome CDP port (default: 9222)

Prerequisites:
  Start Chrome with remote debugging:
  chrome.exe --remote-debugging-port=9222

Configuration is validated at startup. Errors are printed with field paths.
See .env.example for environment variable overrides.
      `);
  }
}

/**
 * Wrap a command handler with config validation.
 * ConfigError is logged as fatal and the process exits with code 2.
 */
async function runWithConfig(commandName, handler) {
  let cfg;
  try {
    // The command name is the first arg; pass the rest to loadConfig
    cfg = loadConfig(commandName, { argv: args.slice(1) });
  } catch (e) {
    if (e instanceof ConfigError) {
      logger.fatal({ command: commandName, issues: e.issues }, 'invalid configuration');
      process.stderr.write('\n' + e.format() + '\n');
      process.exit(2);
    }
    throw e;
  }
  await handler(cfg);
}

async function collect(cfg) {
  const { platform, collection, cdpPort, outputFile } = cfg;

  logger.info({ stage: 'collect', cdpPort, platform, collection }, 'connecting to Chrome CDP');
  const browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
  const context = browser.contexts()[0];

  if (platform === 'douyin') {
    const collector = new DouyinCollector(context);
    const videos = await collector.collect(collection);
    logger.info({ stage: 'collect', count: videos.length, collection }, 'videos collected');

    // Save to file
    const fs = await import('fs');
    fs.writeFileSync(outputFile, JSON.stringify(videos, null, 2));
  }

  await browser.close();
}

async function analyze(cfg) {
  const { analyzer: analyzerName, fallback, mode, cdpPort, inputFile, outputFile, checkpointEnabled, checkpointDb } = cfg;

  logger.info({ stage: 'analyze', analyzer: analyzerName, fallback, mode }, 'analysis starting');

  // Checkpoint setup (Phase A Task 1 — resume on failure)
  const { Checkpoint, checkpointConfigFromArgs } = await import('./core/checkpoint.mjs');
  const cpCfg = checkpointConfigFromArgs(args.slice(1));
  cpCfg.enabled = checkpointEnabled;
  if (checkpointDb) cpCfg.dbPath = checkpointDb;
  const checkpoint = new Checkpoint(cpCfg);
  if (checkpoint.enabled) {
    const stats = checkpoint.getStats();
    if (stats.total > 0) {
      logger.info({ stage: 'analyze', stats, dbPath: cpCfg.dbPath }, 'resuming from checkpoint');
    } else {
      logger.info({ stage: 'analyze', dbPath: cpCfg.dbPath }, 'starting fresh, checkpoint initialized');
    }
  }

  // Round 9 改造: fallback chain 由 cfg 驱动，Router 自动 dedupe
  const fallbackChain = [analyzerName, ...(fallback || []).filter(n => n !== analyzerName)];

  const orchestrator = new Orchestrator({
    cdpPort, mode,
    primaryAnalyzer: analyzerName,
    fallbackChain,
    checkpoint
  });
  await orchestrator.init();

  // Load video list
  const fs = await import('fs');
  const videos = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

  // Register all videos in checkpoint (idempotent)
  if (checkpoint.enabled) {
    checkpoint.registerBatch(videos.map(v => ({ url: v.url, title: v.title })));
  }

  const results = [];
  for (const video of videos) {
    try {
      // Round 20: --mode consensus → 同跑多 AI + arbitrate 字段级投票
      //          --mode sequential (默认) → 主备 fallback 链
      if (mode === 'consensus') {
        const arbitrated = await orchestrator.analyzeConsensus(video);
        // 把 consensus 元数据 attach 到 result 上 → Markdown sink 渲染 frontmatter
        const resultWithConsensus = {
          ...arbitrated.result,
          consensus: arbitrated.consensus,
        };
        if (checkpoint.enabled && arbitrated.result) {
          checkpoint.markCompleted(video.url, resultWithConsensus);
        }
        results.push(resultWithConsensus);
        logger.info({
          stage: 'analyze',
          url: video.url,
          title: video.title?.substring(0, 30),
          confidence: arbitrated.consensus.confidence,
          conflicts: arbitrated.consensus.conflicts.length,
          mode: arbitrated.consensus.mode
        }, 'video analyzed (consensus)');
      } else {
        // Round 9: Router 内部处理 chain + fallback，不传参数
        const result = await orchestrator.analyzeSequential(video);
        results.push(result);
        logger.info({ stage: 'analyze', url: video.url, title: video.title?.substring(0, 30) }, 'video analyzed');
      }
    } catch (e) {
      logger.error({ stage: 'analyze', url: video.url, title: video.title?.substring(0, 30), err: e.message }, 'video analysis failed');
    }
  }

  // Pull all completed results from checkpoint (so resume + fresh both work)
  const finalResults = checkpoint.enabled
    ? checkpoint.getCompletedResults()
    : results;
  fs.writeFileSync(outputFile, JSON.stringify(finalResults, null, 2));
  logger.info({ stage: 'analyze', total: finalResults.length, expected: videos.length, outputFile }, 'analysis complete');

  // Print checkpoint + rate limiter stats
  if (checkpoint.enabled) {
    const cpStats = checkpoint.getStats();
    logger.info({ stage: 'analyze', stats: cpStats }, 'checkpoint summary');
  }
  const stats = orchestrator.agent.limiter?.getStats?.() || getLimiter('doubao').getStats();
  logger.info({ stage: 'analyze', stats }, 'rate limiter summary');

  checkpoint.close();
  await orchestrator.shutdown();
}

async function build(cfg) {
  const { inputFile, outputFile } = cfg;

  const fs = await import('fs');
  const analyses = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

  const builder = new KnowledgeBuilder();
  const kb = builder.build(analyses);

  fs.writeFileSync(outputFile, JSON.stringify(kb, null, 2));
  logger.info({ stage: 'build', total: kb.summary.total, categories: Object.keys(kb.categoryDistribution).length, outputFile }, 'knowledge base built');
}

async function sync(cfg) {
  const { sink: sinkName, inputFile, outputDir } = cfg;

  const fs = await import('fs');
  const kb = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

  if (sinkName === 'markdown') {
    const sink = new MarkdownSink(outputDir ? { outputDir } : {});
    const result = await sink.sink(kb);
    logger.info({ stage: 'sync', sink: 'markdown', files: result.filesWritten, dir: result.outputDir }, 'sink complete');
  } else if (sinkName === 'obsidian') {
    const { ObsidianSink } = await import('./sinks/obsidian.mjs');
    const sink = new ObsidianSink(outputDir ? { outputDir } : {});
    const result = await sink.sink(kb);
    logger.info({ stage: 'sync', sink: 'obsidian', files: result.filesWritten, videos: result.videos, categories: result.categories, dir: result.outputDir }, 'sink complete');
  } else {
    logger.warn({ stage: 'sync', sink: sinkName }, 'sink not implemented, available: markdown, obsidian');
  }
}

main().catch((e) => {
  logger.fatal({ err: e.message, stack: e.stack }, 'cli crashed');
  process.exit(1);
});
