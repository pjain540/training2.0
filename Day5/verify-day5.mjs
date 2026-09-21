#!/usr/bin/env node
/**
 * Day 5 — Automated Verification Suite
 *
 * Comprehensive end-to-end tests for LangChain & LangGraph implementations:
 * 1. Document Chunking & MemoryVectorStore Indexing
 * 2. LCEL RAG Retrieval Chain & Source Citation
 * 3. Strict Fallback on Out-of-Domain Queries
 * 4. ReAct Agent Tool Calling (knowledge_base_search)
 * 5. Composite Multi-Step Task (RAG + Calculator)
 * 6. Multi-Turn Conversation Memory Persistence
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '.env') });
if (!process.env.GEMINI_API_KEY) {
  dotenv.config({ path: join(__dirname, '../Day4/.env') });
}

import { RAGChain } from './src/rag-chain.mjs';
import { createDay5Agent } from './src/agent.mjs';
import { calculatorTool } from './src/tools/rag-tool.mjs';

// ── Test Output Styling ───────────────────────────────────────────────────
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  green:   '\x1b[32m',
  red:     '\x1b[31m',
  yellow:  '\x1b[33m',
  cyan:    '\x1b[36m',
  magenta: '\x1b[35m',
  white:   '\x1b[37m'
};

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function section(title) {
  console.log(`\n${C.bold}${C.cyan}━━━ ${title} ━━━${C.reset}`);
}

function assert(condition, message, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ${C.green}✔ PASS:${C.reset} ${message}`);
  } else {
    failedTests++;
    console.log(`  ${C.red}✖ FAIL:${C.reset} ${message}`);
    if (details) console.log(`    ${C.dim}${details}${C.reset}`);
  }
}

// ── Main Verification Suite ───────────────────────────────────────────────

async function runSuite() {
  const startTime = Date.now();
  console.log(`\n${C.bold}${C.magenta}====================================================${C.reset}`);
  console.log(`${C.bold}${C.white}  DAY 5 — LANGCHAIN & LANGGRAPH VERIFICATION SUITE  ${C.reset}`);
  console.log(`${C.bold}${C.magenta}====================================================${C.reset}`);

  if (!process.env.GEMINI_API_KEY) {
    console.error(`\n${C.red}[Error] GEMINI_API_KEY is not set in Day5/.env!${C.reset}\n`);
    process.exit(1);
  }

  const docsDir = join(__dirname, 'docs');

  // ────────────────────────────────────────────────────────────────────────
  // Test Suite 1: Direct Calculator Tool Sanity
  // ────────────────────────────────────────────────────────────────────────
  section('1. Declarative Calculator Tool');
  try {
    const res1 = await calculatorTool.invoke({ expression: '8760 * (1 - 0.9999)' });
    assert(
      res1.includes('0.8759') || res1.includes('0.876'),
      'Evaluates floating point expressions accurately (8760 * 0.0001 ≈ 0.876)',
      `Got: ${res1}`
    );

    const resSanitized = await calculatorTool.invoke({ expression: '25 + 15' });
    assert(resSanitized.includes('40'), 'Evaluates basic arithmetic correctly', `Got: ${resSanitized}`);

    const resInvalid = await calculatorTool.invoke({ expression: 'invalid_syntax()' });
    assert(
      /error/i.test(resInvalid),
      'Safely catches syntax errors without throwing exception',
      `Got: ${resInvalid}`
    );
  } catch (err) {
    assert(false, 'Calculator tool threw an unhandled exception', err.message);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Test Suite 2: Document Ingestion & VectorStore
  // ────────────────────────────────────────────────────────────────────────
  section('2. Document Ingestion & MemoryVectorStore Indexing');
  const rag = new RAGChain({
    chunkSize: 500,
    chunkOverlap: 100,
    topK: 3
  });

  let stats;
  try {
    stats = await rag.ingest(docsDir, (msg) => {
      // quiet logging during verification
    });
    assert(stats.docsLoaded >= 3, `Loaded all documentation files (loaded ${stats.docsLoaded})`);
    assert(stats.chunksIndexed >= 5, `Successfully chunked documents into vector store (indexed ${stats.chunksIndexed} chunks)`);
    assert(rag.getRetriever() !== null, 'VectorStore retriever initialized successfully');
  } catch (err) {
    assert(false, 'RAG Ingestion threw an exception', err.message);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Test Suite 3: LCEL RAG Query & Citation Verification
  // ────────────────────────────────────────────────────────────────────────
  section('3. LCEL RAG Pipeline & Citation Grounding');
  try {
    const q1 = 'What is the replication topology and consensus protocol in NebulaCloud?';
    const result1 = await rag.query(q1);

    const mentionsRaft = /raft/i.test(result1.answer);
    const mentionsRegions = /region|replication|topology|multi-region/i.test(result1.answer);
    const hasSource = result1.sources.includes('architecture_overview.md');

    assert(
      mentionsRaft || mentionsRegions,
      'Retrieved correct architectural concepts (Raft / multi-region replication)',
      `Answer excerpt: ${result1.answer.slice(0, 100)}...`
    );
    assert(
      hasSource,
      'Extracted accurate source document attribution (architecture_overview.md)',
      `Sources returned: ${JSON.stringify(result1.sources)}`
    );
    assert(
      result1.contextDocs.length > 0,
      'Attached retrieved context documents metadata',
      `Chunks retrieved: ${result1.contextDocs.length}`
    );
  } catch (err) {
    assert(false, 'LCEL RAG query failed', err.message);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Test Suite 4: Strict Fallback Handling
  // ────────────────────────────────────────────────────────────────────────
  section('4. Out-of-Domain Guardrails & Fallback');
  try {
    const qOffTopic = 'What is the recipe for French chocolate mousse with dark cacao?';
    const fallbackResult = await rag.query(qOffTopic);

    const isRefusal =
      fallbackResult.answer.toLowerCase().includes('not contain enough information') ||
      fallbackResult.answer.toLowerCase().includes('sorry') ||
      fallbackResult.answer.toLowerCase().includes('cannot answer');

    assert(
      isRefusal,
      'Refuses to hallucinate on out-of-domain questions not present in docs',
      `Answer: ${fallbackResult.answer}`
    );
  } catch (err) {
    assert(false, 'Fallback query threw an exception', err.message);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Test Suite 5: ReAct Agent Single-Tool Calling
  // ────────────────────────────────────────────────────────────────────────
  section('5. ReAct Agent Tool Calling (knowledge_base_search)');
  let agentInstance;
  try {
    agentInstance = await createDay5Agent({ docsDir });
    assert(agentInstance && typeof agentInstance.invoke === 'function', 'Agent initialized successfully with tools');

    const agentRes1 = await agentInstance.invoke(
      'What HTTP error code represents rate limiting in NebulaCloud troubleshooting guide?'
    );

    const calledRAG = agentRes1.toolCalls.some(t => t.includes('knowledge_base') || t.includes('search'));
    const hasE1003 = agentRes1.answer.includes('E1003') || agentRes1.answer.includes('429');

    assert(
      calledRAG,
      'Agent dynamically selected and called knowledge_base_search tool',
      `Tools called: ${JSON.stringify(agentRes1.toolCalls)}`
    );
    assert(
      hasE1003,
      'Agent returned grounded technical answer with error code E1003',
      `Answer excerpt: ${agentRes1.answer.slice(0, 120)}...`
    );
  } catch (err) {
    assert(false, 'Agent tool execution failed', err.message);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Test Suite 6: Composite Multi-Step Task (RAG + Calculator)
  // ────────────────────────────────────────────────────────────────────────
  section('6. Composite Multi-Step Agent Execution');
  try {
    const multiStepRes = await agentInstance.invoke(
      'Look up the SLA uptime in NebulaCloud docs and calculate how many hours of downtime that allows per year (assuming 8760 hours in a year).'
    );

    const mentionsHours =
      multiStepRes.answer.includes('0.876') ||
      multiStepRes.answer.includes('52.56') || // minutes
      multiStepRes.answer.includes('0.88') ||
      multiStepRes.answer.includes('52.6');

    const usedTools = multiStepRes.toolCalls.length > 0;

    assert(
      usedTools,
      'Agent orchestrated tool execution for multi-step composite question',
      `Tools invoked: ${JSON.stringify(multiStepRes.toolCalls)}`
    );
    assert(
      mentionsHours,
      'Calculated correct annual allowed downtime (~0.876 hours or ~52.56 minutes)',
      `Answer excerpt: ${multiStepRes.answer.slice(0, 150)}...`
    );
  } catch (err) {
    assert(false, 'Composite agent execution failed', err.message);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Test Suite 7: Multi-Turn Conversation Memory
  // ────────────────────────────────────────────────────────────────────────
  section('7. Multi-Turn Conversation Memory');
  try {
    // Turn 1: Introduce user preference
    await agentInstance.invoke('My team project codename is Project-Orion-99.');

    // Turn 2: Query user preference back
    const memRes = await agentInstance.invoke('What is my team project codename that I just told you?');
    const remembered = memRes.answer.includes('Project-Orion-99') || memRes.answer.includes('Orion');

    assert(
      remembered,
      'Agent remembered context across conversational turns using message history',
      `Answer: ${memRes.answer}`
    );
  } catch (err) {
    assert(false, 'Conversation memory test failed', err.message);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Summary
  // ────────────────────────────────────────────────────────────────────────
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n${C.bold}${C.white}────────────────────────────────────────────────────${C.reset}`);
  console.log(`${C.bold}Test Results:${C.reset}`);
  console.log(`  Total:  ${totalTests}`);
  console.log(`  Passed: ${C.green}${passedTests}${C.reset}`);
  console.log(`  Failed: ${failedTests > 0 ? C.red : C.dim}${failedTests}${C.reset}`);
  console.log(`  Time:   ${duration}s`);
  console.log(`${C.bold}${C.white}────────────────────────────────────────────────────${C.reset}\n`);

  if (failedTests > 0) {
    console.error(`${C.red}${C.bold}Verification FAILED with ${failedTests} failure(s).${C.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${C.green}${C.bold}All Day 5 verification tests PASSED successfully! 🎉${C.reset}\n`);
    process.exit(0);
  }
}

runSuite().catch(err => {
  console.error(`${C.red}Fatal test suite error:${C.reset}`, err);
  process.exit(1);
});
