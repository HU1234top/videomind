/**
 * VideoMind CLI — Command-line interface
 */

import { DouyinCollector } from './collectors/douyin.mjs';
import { DoubaoAnalyzer } from './analyzers/doubao.mjs';
import { KnowledgeBuilder } from './builders/knowledge-builder.mjs';
import { MarkdownSink } from './sinks/markdown.mjs';
import { Orchestrator } from './core/orchestrator.mjs';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const command = args[0];

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

  console.log(`[VideoMind] Connecting to Chrome CDP :${cdpPort}...`);
  const browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
  const context = browser.contexts()[0];

  if (platform === 'douyin') {
    const collector = new DouyinCollector(context);
    const videos = await collector.collect(collection);
    console.log(`[VideoMind] Collected ${videos.length} videos from "${collection}"`);
    
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

  console.log(`[VideoMind] Analyzing with ${analyzerName} in ${mode} mode...`);
  const orchestrator = new Orchestrator({ cdpPort, mode, primaryAnalyzer: analyzerName });
  await orchestrator.init();

  // Load video list
  const fs = await import('fs');
  const videos = JSON.parse(fs.readFileSync('video_list.json', 'utf8'));

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
      console.log(`[VideoMind] ✓ ${video.title.substring(0, 30)}...`);
    } catch (e) {
      console.log(`[VideoMind] ✗ ${video.title.substring(0, 30)}... — ${e.message}`);
    }
  }

  fs.writeFileSync('video_analysis.json', JSON.stringify(results, null, 2));
  console.log(`[VideoMind] Analysis complete: ${results.length}/${videos.length} videos`);

  await orchestrator.shutdown();
}

async function build(args) {
  const input = getArg(args, '--input') || 'video_analysis.json';
  
  const fs = await import('fs');
  const analyses = JSON.parse(fs.readFileSync(input, 'utf8'));
  
  const builder = new KnowledgeBuilder();
  const kb = builder.build(analyses);
  
  fs.writeFileSync('structured_knowledge_base.json', JSON.stringify(kb, null, 2));
  console.log(`[VideoMind] Knowledge base built: ${kb.summary.total} videos, ${Object.keys(kb.categoryDistribution).length} categories`);
}

async function sync(args) {
  const sinkName = getArg(args, '--sink') || 'markdown';
  
  const fs = await import('fs');
  const kb = JSON.parse(fs.readFileSync('structured_knowledge_base.json', 'utf8'));
  
  if (sinkName === 'markdown') {
    const sink = new MarkdownSink();
    const result = await sink.sink(kb);
    console.log(`[VideoMind] Synced to Markdown: ${result.filesWritten} files in ${result.outputDir}`);
  } else {
    console.log(`[VideoMind] Sink "${sinkName}" not yet implemented`);
  }
}

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

main().catch(console.error);
