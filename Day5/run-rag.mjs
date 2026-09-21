#!/usr/bin/env node
/**
 * Day 5 — RAG Chain CLI Runner
 *
 * Queries the LangChain LCEL RAG chain directly and shows the grounded
 * answer + source citations + timing stats.
 *
 * Usage:
 *   node run-rag.mjs "What is the replication topology in NebulaCloud?"
 *   node run-rag.mjs -q "How does NebulaCloud handle distributed consensus?"
 */
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

import { RAGChain } from './src/rag-chain.mjs';

// ─── CLI ──────────────────────────────────────────────────────────────────────

const { values, positionals } = parseArgs({
  options: {
    query:   { type: 'string',  short: 'q' },
    help:    { type: 'boolean', short: 'h', default: false }
  },
  allowPositionals: true,
  strict: false
});

const question = values.query ?? positionals[0];

if (values.help || !question) {
  console.log(`
\x1b[1m\x1b[36mrun-rag.mjs\x1b[0m — Day 5 LangChain RAG Chain CLI

\x1b[1mUSAGE:\x1b[0m
  node run-rag.mjs "<question>"
  node run-rag.mjs -q "<question>"

\x1b[1mEXAMPLES:\x1b[0m
  node run-rag.mjs "What is the replication topology in NebulaCloud?"
  node run-rag.mjs "How does NebulaCloud handle distributed consensus?"
  node run-rag.mjs "What error code indicates a rate limit exceeded?"
`);
  process.exit(0);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const DOCS_DIR = join(__dirname, 'docs');
const RESET = '\x1b[0m';
const CYAN  = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';

async function main() {
  console.log(`\n${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD} Day 5 — LangChain LCEL RAG Chain${RESET}`);
  console.log(`${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);

  const rag = new RAGChain();

  // Ingest phase
  const t0 = Date.now();
  const stats = await rag.ingest(DOCS_DIR, msg => console.log(`  ${DIM}${msg}${RESET}`));
  const ingestMs = Date.now() - t0;
  console.log(`\n  ${GREEN}✅ Ingested: ${stats.docsLoaded} docs → ${stats.chunksIndexed} chunks (${ingestMs}ms)${RESET}\n`);

  // Query phase
  console.log(`${BOLD}Question:${RESET} ${question}\n`);
  const t1 = Date.now();
  const { answer, sources } = await rag.query(question);
  const queryMs = Date.now() - t1;

  console.log(`${BOLD}${GREEN}Answer:${RESET}\n${answer}\n`);

  if (sources.length > 0) {
    console.log(`${BOLD}${YELLOW}Sources:${RESET}`);
    for (const src of sources) {
      console.log(`  • ${src}`);
    }
  }

  console.log(`\n${DIM}Query time: ${queryMs}ms${RESET}`);
  console.log(`${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);
}

main().catch(err => {
  console.error('\x1b[31m[Error]\x1b[0m', err.message);
  process.exit(1);
});
