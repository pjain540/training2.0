#!/usr/bin/env node
/**
 * Day 3 — RAG Query Script
 * Usage:
 *   node query.mjs "Your question here"    ← single shot
 *   node query.mjs --chat                  ← interactive REPL
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { access } from 'node:fs/promises';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });

import { RAGPipeline, DEFAULT_FALLBACK_MESSAGE } from './src/rag-pipeline.mjs';

// ── Color Helpers ─────────────────────────────────────────────────────────

const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
};

const c = (color, str) => `${C[color]}${str}${C.reset}`;

function printBanner() {
  console.log('\n' + c('bold', c('magenta', '╔══════════════════════════════════════════════════╗')));
  console.log(c('bold', c('magenta',         '║      🔍  RAG Query Engine — Day 3               ║')));
  console.log(c('bold', c('magenta',         '╚══════════════════════════════════════════════════╝')) + '\n');
}

function printRule() {
  console.log(c('dim', '  ' + '─'.repeat(56)));
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Prints a single RAG result with retrieved chunks, score, citations, and answer.
 */
function printResult(result) {
  const {
    question, answer, isFallback, topScore, thresholdUsed,
    citations, retrievedChunks, latencyMs
  } = result;

  console.log();
  printRule();
  console.log(`\n  ${c('bold', '❓ Question')}: ${question}\n`);

  // Retrieved Chunks Summary
  console.log(c('bold', '  📄 Retrieved Chunks') + ' ' + c('dim', `(top similarity: ${topScore.toFixed(3)}, threshold: ${thresholdUsed})`));
  if (retrievedChunks && retrievedChunks.length > 0) {
    for (const chunk of retrievedChunks) {
      const src = chunk.metadata?.source || 'unknown';
      const idx = chunk.metadata?.chunkIndex ?? '?';
      const score = chunk.score?.toFixed(3) || '?';
      const preview = chunk.text.slice(0, 80).replace(/\n/g, ' ').trim() + (chunk.text.length > 80 ? '…' : '');
      console.log(c('cyan', `     [${src}, Chunk ${idx}]`) + c('dim', ` score=${score}`));
      console.log(c('dim', `       "${preview}"`));
    }
  } else {
    console.log(c('dim', '     (no chunks above threshold)'));
  }

  console.log();

  // Answer
  if (isFallback) {
    console.log(c('bold', '  ⚠️  Answer') + c('yellow', ' [FALLBACK — No relevant chunks found]:'));
    console.log(c('yellow', `\n  ${answer}\n`));
  } else {
    console.log(c('bold', '  💡 Answer') + c('dim', ' [Grounded]:'));
    console.log();
    // Wrap and indent answer lines
    for (const line of answer.split('\n')) {
      console.log('  ' + line);
    }
    console.log();

    // Citations
    if (citations && citations.length > 0) {
      console.log(c('bold', '  📌 Citations used:'));
      const unique = [...new Set(citations.map((ci) => ci.raw))];
      for (const raw of unique) {
        console.log(c('cyan', `     ${raw}`));
      }
      console.log();
    }
  }

  console.log(c('dim', `  ⏱  Answered in ${formatDuration(latencyMs)}`));
  printRule();
  console.log();
}

// ── Single Query Mode ─────────────────────────────────────────────────────

async function runSingleQuery(pipeline, question) {
  console.log(c('cyan', '  Querying...'));
  try {
    const result = await pipeline.query(question, {
      topK: 4,
      minScore: 0.45
    });
    printResult(result);
  } catch (err) {
    console.error('\n' + c('red', '  ✖ Query failed: ') + err.message + '\n');
    process.exit(1);
  }
}

// ── Interactive Chat REPL ─────────────────────────────────────────────────

async function runChatMode(pipeline) {
  console.log(c('bold', c('green', '  💬 Interactive Chat Mode')));
  console.log(c('dim', '  Ask anything grounded in your docs. Type "exit" or "quit" to stop.\n'));
  printRule();
  console.log();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const askQuestion = () => {
    rl.question(c('bold', c('cyan', '  You: ')), async (input) => {
      const question = input.trim();
      if (!question) {
        askQuestion();
        return;
      }
      if (['exit', 'quit', 'q'].includes(question.toLowerCase())) {
        console.log(c('green', '\n  👋 Goodbye!\n'));
        rl.close();
        return;
      }

      try {
        console.log(c('dim', '  Thinking...\n'));
        const result = await pipeline.query(question, { topK: 4, minScore: 0.45 });
        printResult(result);
      } catch (err) {
        console.error(c('red', '  ✖ Error: ') + err.message + '\n');
      }

      askQuestion();
    });
  };

  askQuestion();
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  printBanner();

  const storagePath = join(__dirname, 'data/vector_store.json');

  // Check if vector store exists
  try {
    await access(storagePath);
  } catch {
    console.error(c('red', '  ✖ Vector store not found.'));
    console.error(c('dim', `  Expected: ${storagePath}`));
    console.error(c('yellow', '\n  Run ingestion first:'));
    console.error(c('cyan',   '    node ingest.mjs\n'));
    process.exit(1);
  }

  // Initialize and load the pipeline
  const pipeline = new RAGPipeline({ storagePath });

  console.log(c('cyan', '  Loading vector index...'));
  const count = await pipeline.loadStore(storagePath);
  const stats = pipeline.vectorStore.getStats();
  console.log(c('green', `  ✔ Loaded ${count} chunks from ${stats.uniqueSources.length} source(s)\n`));

  const args = process.argv.slice(2);
  const isChatMode = args.includes('--chat') || args.includes('-c');
  const question = args.filter((a) => !a.startsWith('-')).join(' ').trim();

  if (isChatMode) {
    await runChatMode(pipeline);
  } else if (question) {
    await runSingleQuery(pipeline, question);
  } else {
    console.log(c('yellow', '  Usage:'));
    console.log(c('cyan',   '    node query.mjs "Your question"'));
    console.log(c('cyan',   '    node query.mjs --chat') + c('dim', '   (interactive REPL)\n'));
    console.log(c('dim', '  Example questions:'));
    console.log(c('dim', '    node query.mjs "What is the availability SLA?"'));
    console.log(c('dim', '    node query.mjs "How do I fix ERR_RAFT_LEADER_ELECT_FAILED?"'));
    console.log(c('dim', '    node query.mjs "What encryption standard is used for data at rest?"\n'));
    await runChatMode(pipeline);
  }
}

main().catch((err) => {
  console.error('\n' + c('red', '  ✖ Fatal Error:'), err.message);
  process.exit(1);
});
