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
  const { analyzer: analyzerName, mode, cdpPort, inputFile, outputFile, checkpointEnabled, checkpointDb } = cfg;

  logger.info({ stage: 'analyze', analyzer: analyzerName, mode }, 'analysis starting');

  // Checkpoint setup (Phase A Task 1 — resume on failure)
  const { Checkpoint, checkpointConfigFromArgs } = await import('./core/checkpoint.mjs');
  // checkpointConfigFromArgs still operates on the raw argv; pass it the original
  // CLI slice (args minus the command name) so existing behavior is preserved.
  const cpCfg = checkpointConfigFromArgs(args.slice(1));
  // Override with validated values (single source of truth)
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

  const orchestrator = new Orchestrator({ cdpPort, mode, primaryAnalyzer: analyzerName, checkpoint });
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
      if (mode === 'sequential') {
        const result = await orchestrator.analyzeSequential(video, analyzerName, ['doubao', 'kimi', 'gemini']);
        results.push(result);
      } else {
        const result = await orchestrator.analyzeParallel(video, ['doubao', 'kimi', 'gemini']);
        results.push(result);
      }
      logger.info({ stage: 'analyze', url: video.url, title: video.title?.substring(0, 30) }, 'video analyzed');
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
    const sink = new MarkdownSink();
    const result = await sink.sink(kb);
    logger.info({ stage: 'sync', sink: 'markdown', files: result.filesWritten, dir: result.outputDir }, 'sink complete');
  } else if (sinkName === 'obsidian') {
    const { ObsidianSink } = await import('./sinks/obsidian.mjs');
    const sink = new ObsidianSink();
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
