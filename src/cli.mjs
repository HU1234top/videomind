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
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const command = args[0];
const logger = createLogger({ name: 'videomind', base: { component: 'cli' } });

async function main() {
  switch (command) {
    case 'collect':
      await collect(args);
      break;
    case 'analyze':
      await analyze(args);
      break;
    case 'build':
      await build(args);
      break;
    case 'sync':
      await sync(args);
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
  --platform    douyin | bilibili | youtube (default: douyin)
  --collection  Favorites collection name (default: skills)
  --analyzer    doubao | kimi | gemini | claude (default: doubao)
  --sink        markdown | lexiang | obsidian | notion (default: markdown)
  --mode        sequential | parallel (default: sequential)
  --cdp-port    Chrome CDP port (default: 9222)

Prerequisites:
  Start Chrome with remote debugging:
  chrome.exe --remote-debugging-port=9222
      `);
  }
}

async function collect(args) {
  const platform = getArg(args, '--platform') || 'douyin';
  const collection = getArg(args, '--collection') || 'skills';
  const cdpPort = parseInt(getArg(args, '--cdp-port') || '9222');

  logger.info({ stage: 'collect', cdpPort, platform, collection }, 'connecting to Chrome CDP');
  const browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
  const context = browser.contexts()[0];

  if (platform === 'douyin') {
    const collector = new DouyinCollector(context);
    const videos = await collector.collect(collection);
    logger.info({ stage: 'collect', count: videos.length, collection }, 'videos collected');

    // Save to file
    const fs = await import('fs');
    fs.writeFileSync('video_list.json', JSON.stringify(videos, null, 2));
  }

  await browser.close();
}

async function analyze(args) {
  const analyzerName = getArg(args, '--analyzer') || 'doubao';
  const mode = getArg(args, '--mode') || 'sequential';
  const cdpPort = parseInt(getArg(args, '--cdp-port') || '9222');

  logger.info({ stage: 'analyze', analyzer: analyzerName, mode }, 'analysis starting');

  // Checkpoint setup (Phase A Task 1 — resume on failure)
  const { Checkpoint, checkpointConfigFromArgs } = await import('./core/checkpoint.mjs');
  const cpCfg = checkpointConfigFromArgs(args);
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
  const videos = JSON.parse(fs.readFileSync('video_list.json', 'utf8'));

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
  fs.writeFileSync('video_analysis.json', JSON.stringify(finalResults, null, 2));
  logger.info({ stage: 'analyze', total: finalResults.length, expected: videos.length }, 'analysis complete');

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

async function build(args) {
  const input = getArg(args, '--input') || 'video_analysis.json';
  
  const fs = await import('fs');
  const analyses = JSON.parse(fs.readFileSync(input, 'utf8'));
  
  const builder = new KnowledgeBuilder();
  const kb = builder.build(analyses);
  
  fs.writeFileSync('structured_knowledge_base.json', JSON.stringify(kb, null, 2));
  logger.info({ stage: 'build', total: kb.summary.total, categories: Object.keys(kb.categoryDistribution).length }, 'knowledge base built');
}

async function sync(args) {
  const sinkName = getArg(args, '--sink') || 'markdown';

  const fs = await import('fs');
  const kb = JSON.parse(fs.readFileSync('structured_knowledge_base.json', 'utf8'));

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

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

main().catch((e) => {
  logger.fatal({ err: e.message, stack: e.stack }, 'cli crashed');
  process.exit(1);
});
