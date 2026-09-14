#!/usr/bin/env node
/**
 * Day 3 — RAG Ingestion Script
 * Usage: node ingest.mjs [docs-directory]
 *
 * Scans the docs/ folder (or a custom directory), chunks all documents,
 * generates Gemini embeddings, and saves the vector index to data/vector_store.json.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { access } from 'node:fs/promises';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });

import { RAGPipeline } from './src/rag-pipeline.mjs';

// ── Helpers ────────────────────────────────────────────────────────────────

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
  dim: '\x1b[2m'
};

function c(color, str) {
  return `${colors[color]}${str}${colors.reset}`;
}

function printBanner() {
  console.log('\n' + c('bold', c('cyan', '╔══════════════════════════════════════════════════╗')));
  console.log(c('bold', c('cyan',       '║       🔮  RAG Ingest Pipeline — Day 3           ║')));
  console.log(c('bold', c('cyan',       '╚══════════════════════════════════════════════════╝')) + '\n');
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function printStep(step, text) {
  console.log(c('blue', `  [${step}]`) + ' ' + text);
}

function printSuccess(text) {
  console.log(c('green', '  ✔') + ' ' + text);
}

function printProgress(status) {
  process.stdout.write('\r' + c('yellow', '  ⏳') + ' ' + status.padEnd(70));
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  printBanner();

  const docsDir = process.argv[2]
    ? resolve(process.argv[2])
    : join(__dirname, 'docs');

  // Validate docs directory exists
  try {
    await access(docsDir);
  } catch {
    console.error(c('red', `\n  ✖ ERROR: Document directory not found: ${docsDir}`));
    console.error(c('dim', `  Create a "docs/" folder and add .md, .txt, or .pdf files.\n`));
    process.exit(1);
  }

  printStep('1/4', `Scanning documents in: ${c('cyan', docsDir)}`);

  const pipeline = new RAGPipeline({
    storagePath: join(__dirname, 'data/vector_store.json')
  });

  let lastStatus = '';
  const stats = await pipeline.ingestDirectory(docsDir, {
    chunkSize: 600,
    chunkOverlap: 120,
    persist: true,
    onStatus: (status, progress) => {
      if (status !== lastStatus) {
        if (lastStatus) {
          process.stdout.write('\n');
        }
        printProgress(status);
        lastStatus = status;
      }
    }
  });

  process.stdout.write('\n\n');

  // ── Summary Table ──
  printSuccess(c('bold', 'Ingestion complete!'));
  console.log('\n' + c('bold', '  📊 Ingestion Summary'));
  console.log(c('dim', '  ─────────────────────────────────────────────────'));
  console.log(`  ${c('cyan', 'Documents loaded')}    : ${c('bold', stats.documentsLoaded)}`);
  console.log(`  ${c('cyan', 'Chunks indexed')}      : ${c('bold', stats.chunksIndexed)}`);
  console.log(`  ${c('cyan', 'Embedding dimensions')}: ${c('bold', stats.embeddingDimensions)}`);
  console.log(`  ${c('cyan', 'Total duration')}      : ${c('bold', formatDuration(stats.durationMs))}`);
  console.log(`  ${c('cyan', 'Vector store saved')}  : ${c('green', stats.storagePath)}`);
  console.log(c('dim', '  ─────────────────────────────────────────────────'));
  console.log();
  console.log(c('green', '  ✔ Ready to query! Run:'));
  console.log(c('cyan',  '    node query.mjs "Your question here"'));
  console.log(c('cyan',  '    node query.mjs --chat') + c('dim', '   (interactive REPL)'));
  console.log();
}

main().catch((err) => {
  console.error('\n' + c('red', '  ✖ Fatal Error:'), err.message);
  process.exit(1);
});
