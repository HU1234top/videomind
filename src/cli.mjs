/**
 * VideoMind CLI — Command-line interface
 *
 * Enhanced: --verbose/-v, --output-dir, structured error handling,
 * honest --help output matching actual implementation status.
 */

import { DouyinCollector } from './collectors/douyin.mjs';
import { DoubaoAnalyzer } from './analyzers/doubao.mjs';
import { KnowledgeBuilder } from './builders/knowledge-builder.mjs';
import { MarkdownSink } from './sinks/markdown.mjs';
import { Orchestrator } from './core/orchestrator.mjs';
import { getLimiter } from './core/rate-limiter.mjs';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const command = args[0];
const verbose = args.includes('-v') || args.includes('--verbose');
const outputDir = getArg(args, '--output-dir') || process.cwd();

function log(msg) {
  console.log(`[VideoMind] ${msg}`);
}
function debug(msg) {
  if (verbose) console.log(`[VideoMind:debug] ${msg}`);
}

async function main() {
  try {
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
      case 'help':
      case '--help':
      case '-h':
        showHelp();
        break;
      default:
        showHelp();
        process.exitCode = 1;
    }
  } catch (e) {
    if (e.code === 'CAPTCHA_DETECTED') {
      console.error(`\n⚠️  CAPTCHA detected! Please handle it manually in your browser, then retry.\n`);
      process.exitCode = 2;
    } else if (e.message?.includes('connectOverCDP')) {
      console.error(`\n❌ Cannot connect to Chrome CDP. Make sure Chrome is running with --remote-debugging-port=9222\n`);
      process.exitCode = 3;
    } else {
      console.error(`\n❌ Error: ${e.message}\n`);
      if (verbose) console.error(e.stack);
      process.exitCode = 1;
    }
  }
}

function showHelp() {
  console.log(`
VideoMind CLI — Turn your video favorites into a knowledge base

Usage:
  node src/cli.mjs collect   --platform <platform> --collection <name>
  node src/cli.mjs analyze   --analyzer <analyzer> [--enrich-comments]
  node src/cli.mjs build     --input <file>
  node src/cli.mjs sync      --sink <sink>

Commands:
  collect    Scrape video metadata from a favorites collection
  analyze    Run AI analysis on collected videos
  build      Build structured knowledge base from analysis results
  sync       Export knowledge base to a destination format

Options:
  --platform      douyin (only douyin works currently)
  --collection    Favorites collection name (default: skills)
  --analyzer      doubao (only doubao works currently — kimi/gemini/claude throw errors)
  --sink          markdown (only markdown works currently)
  --mode          sequential | parallel (default: sequential; parallel needs 2+ analyzers)
  --cdp-port      Chrome CDP port (default: 9222)
  --output-dir    Output directory for JSON/Markdown files (default: current dir)
  --enrich-comments  Fetch comments before analysis (default: true, use --enrich-comments false to skip)
  -v, --verbose   Enable debug logging

Prerequisites:
  Start Chrome with remote debugging:
    chrome.exe --remote-debugging-port=9222

Implementation status:
  See docs/STATUS.md for what's actually working vs. planned.
  Currently only: Douyin Collector + Doubao Analyzer + Markdown Sink.
      `);
}

async function collect(args) {
  const platform = getArg(args, '--platform') || 'douyin';
  const collection = getArg(args, '--collection') || 'skills';
  const cdpPort = parseInt(getArg(args, '--cdp-port') || '9222');
  const outPath = resolvePath(outputDir, 'video_list.json');

  if (platform !== 'douyin') {
    console.error(`Platform "${platform}" collector not yet implemented. Only "douyin" works currently.`);
    process.exitCode = 1;
    return;
  }

  log(`Connecting to Chrome CDP :${cdpPort}...`);
  const browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
  const context = browser.contexts()[0];

  const collector = new DouyinCollector(context);
  const videos = await collector.collect(collection);
  log(`Collected ${videos.length} videos from "${collection}"`);

  const fs = await import('fs');
  fs.writeFileSync(outPath, JSON.stringify(videos, null, 2));
  debug(`Saved to ${outPath}`);

  // disconnect() only closes the Playwright connection,
  // keeping the user's real Chrome browser alive.
  await browser.disconnect();
}

async function analyze(args) {
  const analyzerName = getArg(args, '--analyzer') || 'doubao';
  const mode = getArg(args, '--mode') || 'sequential';
  const cdpPort = parseInt(getArg(args, '--cdp-port') || '9222');
  const enrichComments = getArg(args, '--enrich-comments') !== 'false';

  if (analyzerName !== 'doubao') {
    console.error(`Analyzer "${analyzerName}" not yet implemented. Only "doubao" works currently.`);
    process.exitCode = 1;
    return;
  }

  const inputPath = resolvePath(outputDir, 'video_list.json');
  const outputPath = resolvePath(outputDir, 'video_analysis.json');

  log(`Analyzing with ${analyzerName} in ${mode} mode...`);

  // Checkpoint setup (Phase A Task 1 — resume on failure)
  const { Checkpoint, checkpointConfigFromArgs } = await import('./core/checkpoint.mjs');
  const cpCfg = checkpointConfigFromArgs(args);
  const checkpoint = new Checkpoint(cpCfg);
  if (checkpoint.enabled) {
    const stats = checkpoint.getStats();
    if (stats.total > 0) {
      log(`Resuming: ${stats.completed} done, ${stats.failed} failed, ${stats.in_progress} in progress`);
    } else {
      log(`Starting fresh: checkpoint db at ${cpCfg.dbPath}`);
    }
  }

  const orchestrator = new Orchestrator({ cdpPort, mode, primaryAnalyzer: analyzerName, checkpoint });
  await orchestrator.init();

  const fs = await import('fs');
  const videos = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  debug(`Loaded ${videos.length} videos from ${inputPath}`);

  // Register all videos in checkpoint (idempotent)
  if (checkpoint.enabled) {
    checkpoint.registerBatch(videos.map(v => ({ url: v.url, title: v.title })));
  }

  // Enrich videos with comments before analysis
  if (enrichComments) {
    const collector = new DouyinCollector(orchestrator.agent.context);
    log('Enriching videos with comments...');
    for (let i = 0; i < videos.length; i++) {
      if (!videos[i].comments || videos[i].comments.length === 0) {
        try {
          videos[i].comments = await collector.fetchComments(videos[i].url, 5);
          log(`Enriched comments for "${videos[i].title?.substring(0, 30)}" (${videos[i].comments.length} comments)`);
        } catch (e) {
          debug(`Comment enrichment failed: ${e.message}`);
        }
        await collector.limiter.delay();
      }
    }
    const enrichedPath = resolvePath(outputDir, 'video_list_enriched.json');
    fs.writeFileSync(enrichedPath, JSON.stringify(videos, null, 2));
    debug(`Enriched list saved to ${enrichedPath}`);
  }

  const results = [];
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    try {
      const fallbackChain = ['doubao'];
      if (mode === 'sequential') {
        const result = await orchestrator.analyzeSequential(video, analyzerName, fallbackChain);
        results.push(result);
      } else {
        const result = await orchestrator.analyzeParallel(video, fallbackChain);
        results.push(result);
      }
      log(`✓ [${i+1}/${videos.length}] ${video.title?.substring(0, 30)}...`);
    } catch (e) {
      log(`✗ [${i+1}/${videos.length}] ${video.title?.substring(0, 30)}... — ${e.message}`);
      results.push({ url: video.url, title: video.title, error: e.message, failed: true });

      // CAPTCHA: stop immediately
      if (e.code === 'CAPTCHA_DETECTED') throw e;
    }
  }

  // Pull all completed results from checkpoint (so resume + fresh both work)
  const finalResults = checkpoint.enabled
    ? checkpoint.getCompletedResults()
    : results;
  fs.writeFileSync(outputPath, JSON.stringify(finalResults, null, 2));
  log(`Analysis complete: ${finalResults.length}/${videos.length} videos succeeded → ${outputPath}`);

  // Print checkpoint + rate limiter stats
  if (checkpoint.enabled) {
    const cpStats = checkpoint.getStats();
    log(`Checkpoint: ${JSON.stringify(cpStats)}`);
  }
  const stats = getLimiter('doubao').getStats();
  log(`Doubao rate limiter: ${JSON.stringify(stats)}`);

  checkpoint.close();
  await orchestrator.shutdown();
}

async function build(args) {
  const input = resolvePath(outputDir, getArg(args, '--input') || 'video_analysis.json');
  const outputPath = resolvePath(outputDir, 'structured_knowledge_base.json');

  const fs = await import('fs');
  const analyses = JSON.parse(fs.readFileSync(input, 'utf8'));

  const builder = new KnowledgeBuilder();
  const kb = builder.build(analyses);

  fs.writeFileSync(outputPath, JSON.stringify(kb, null, 2));
  log(`Knowledge base built: ${kb.summary.total} videos, ${Object.keys(kb.categoryDistribution).length} categories → ${outputPath}`);
}

async function sync(args) {
  const sinkName = getArg(args, '--sink') || 'markdown';
  const inputPath = resolvePath(outputDir, 'structured_knowledge_base.json');

  if (sinkName === 'markdown') {
    const sink = new MarkdownSink();
    const result = await sink.sink(kb);
    log(`Synced to Markdown: ${result.filesWritten} files in ${result.outputDir}`);
  } else if (sinkName === 'obsidian') {
    const { ObsidianSink } = await import('./sinks/obsidian.mjs');
    const sink = new ObsidianSink();
    const result = await sink.sink(kb);
    log(`Synced to Obsidian vault: ${result.filesWritten} files (${result.videos} videos, ${result.categories} categories) in ${result.outputDir}`);
  } else {
    console.log(`[VideoMind] Sink "${sinkName}" not yet implemented (available: markdown, obsidian)`);
  }
}

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

function resolvePath(base, relative) {
  const { resolve } = await import('path');
  return resolve(base, relative);
}

// Actually, resolve is synchronous — fix the function
import { resolve } from 'path';
function resolvePathSync(base, relative) {
  return resolve(base, relative);
}
// Replace usage (keeping resolvePath name for compatibility)
const resolvePath = resolvePathSync;

main();
