#!/usr/bin/env node
/**
 * Day 6 — Automated Verification Suite for LangGraph Multi-Agent Architecture
 *
 * Validates:
 *   Test 1: LangGraph State Annotation Schema & Default Values
 *   Test 2: Researcher Node (Grounded Retrieval / Fallback)
 *   Test 3: Writer & Critic Node Logic with Mock/Unit test
 *   Test 4: Conditional Edge Routing (Revision Cycle & Convergence)
 *   Test 5: MemorySaver Checkpointing & Interrupt Pause
 *   Test 6: HITL Resumption with APPROVED, EDITED, and REJECTED decisions
 *   Test 7: End-to-End LangGraph Pipeline Execution
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { rm, readFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import { StateGraph, START, END, MemorySaver, Command } from '@langchain/langgraph';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });
if (!process.env.GEMINI_API_KEY) {
  dotenv.config({ path: join(__dirname, '../Day4/.env') });
}
if (!process.env.GEMINI_API_KEY) {
  dotenv.config({ path: join(__dirname, '../Day3/.env') });
}

import { PipelineStateAnnotation, AgentStatus, formatLog } from './src/state.mjs';
import { createResearcherNode } from './src/nodes/researcher.mjs';
import { createHumanApprovalNode } from './src/nodes/human.mjs';
import { createMultiAgentGraph, routeAfterCritic } from './src/graph.mjs';

// ── Color Utilities ────────────────────────────────────────────────────────
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  green:   '\x1b[32m',
  red:     '\x1b[31m',
  cyan:    '\x1b[36m',
  yellow:  '\x1b[33m'
};

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ${C.green}✔ PASS${C.reset}: ${label}`);
    passed++;
  } else {
    console.log(`  ${C.red}✖ FAIL${C.reset}: ${label}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${C.bold}${C.cyan}── ${title} ──${C.reset}`);
}

async function runTests() {
  console.log(`${C.bold}══════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}    🧪  Day 6: LangGraph Multi-Agent Verification Suite    ${C.reset}`);
  console.log(`${C.bold}══════════════════════════════════════════════════════════${C.reset}`);

  const testOutputDir = join(__dirname, '.test_output');
  await rm(testOutputDir, { recursive: true, force: true });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 1: State Annotation Schema
  // ──────────────────────────────────────────────────────────────────────────
  section('Test 1: State Annotation Schema & Defaults');
  try {
    const builder = new StateGraph(PipelineStateAnnotation)
      .addNode('dummy', (state) => ({ logs: [formatLog('Test', 'initialized')] }))
      .addEdge(START, 'dummy')
      .addEdge('dummy', END);
    const compiled = builder.compile();

    const res = await compiled.invoke({ topic: 'Distributed Consensus' });
    assert(res.topic === 'Distributed Consensus', 'State retains user topic');
    assert(res.iteration === 0, 'Default iteration is 0');
    assert(res.maxIterations === 1, 'Default maxIterations is 1');
    assert(Array.isArray(res.facts), 'Facts initialized as array');
    assert(Array.isArray(res.draftHistory), 'Draft history initialized as array');
    assert(res.status === AgentStatus.INITIALIZED, 'Initial status matches AgentStatus.INITIALIZED');
    assert(res.logs.length >= 1, 'Logs reducer correctly appends entries');
  } catch (err) {
    assert(false, `Test 1 failed with error: ${err.message}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 2: Researcher Node
  // ──────────────────────────────────────────────────────────────────────────
  section('Test 2: Researcher Node Execution');
  try {
    const researcher = createResearcherNode();
    const result = await researcher({ topic: 'NebulaCloud high availability and SLA' });

    assert(Array.isArray(result.facts) && result.facts.length > 0, `Researcher retrieved ${result.facts?.length} facts`);
    assert(result.status === AgentStatus.RESEARCHED, 'Status updated to RESEARCHED');
    assert(Array.isArray(result.citations) && result.citations.length > 0, 'Citations populated');
    assert(result.facts[0].source && result.facts[0].content, 'Facts have source and content attributes');
  } catch (err) {
    assert(false, `Test 2 failed with error: ${err.message}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 3: Conditional Routing Logic (routeAfterCritic)
  // ──────────────────────────────────────────────────────────────────────────
  section('Test 3: Conditional Routing Edge');
  try {
    // Case A: Critique says REVISE and iteration < maxIterations -> loops to writer
    const stateRevise = {
      iteration: 0,
      maxIterations: 1,
      critiqueHistory: [{ status: 'REVISE', score: 6.0 }]
    };
    assert(routeAfterCritic(stateRevise) === 'writer', 'Routes to "writer" when status is REVISE and iteration < max');

    // Case B: Critique says APPROVED -> proceeds to humanApproval
    const stateApproved = {
      iteration: 0,
      maxIterations: 1,
      critiqueHistory: [{ status: 'APPROVED', score: 9.0 }]
    };
    assert(routeAfterCritic(stateApproved) === 'humanApproval', 'Routes to "humanApproval" when status is APPROVED');

    // Case C: Critique says REVISE but iteration reaches maxIterations -> forces convergence to humanApproval
    const stateMaxed = {
      iteration: 1,
      maxIterations: 1,
      critiqueHistory: [{ status: 'REVISE', score: 6.5 }]
    };
    assert(routeAfterCritic(stateMaxed) === 'humanApproval', 'Routes to "humanApproval" when max iterations reached (prevents infinite cycle)');
  } catch (err) {
    assert(false, `Test 3 failed with error: ${err.message}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 4: MemorySaver Checkpointing & Interrupt Pause
  // ──────────────────────────────────────────────────────────────────────────
  section('Test 4: Checkpointing & HITL Interrupt Pause');
  const threadId = 'test-thread-hitl';
  const config = { configurable: { thread_id: threadId } };
  const checkpointer = new MemorySaver();

  try {
    // Build a graph with a mocked writer/critic that returns APPROVED to test human interrupt
    const testGraph = createMultiAgentGraph({
      checkpointer,
      outputDir: testOutputDir,
      nodes: {
        researcher: async () => ({ facts: [{ source: 'doc.md', chunkIndex: 0, content: 'Mock fact' }] }),
        writer: async () => ({ draft: '# Mock Draft\nContent with fact.', iteration: 0 }),
        critic: async () => ({ critiqueHistory: [{ status: 'APPROVED', score: 9 }] }),
        humanApproval: createHumanApprovalNode({ outputDir: testOutputDir })
      }
    });

    // Run until interrupt
    await testGraph.invoke({ topic: 'HITL Checkpoint Test' }, config);

    const snapshot = await testGraph.getState(config);
    assert(snapshot.next.includes('humanApproval'), 'Graph paused at humanApproval node');
    assert(snapshot.tasks.some(t => t.interrupts.length > 0), 'Checkpointer captured interrupt task');
    assert(snapshot.values.draft.includes('Mock Draft'), 'Checkpoint preserves draft in state');
  } catch (err) {
    assert(false, `Test 4 failed with error: ${err.message}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 5: Resuming with Human Decisions (APPROVED, EDITED, REJECTED)
  // ──────────────────────────────────────────────────────────────────────────
  section('Test 5: Resuming Execution Across All Human Decision Pathways');
  try {
    // 5A: APPROVED
    const testGraphApproved = createMultiAgentGraph({
      checkpointer: new MemorySaver(),
      outputDir: testOutputDir,
      nodes: {
        researcher: async () => ({ facts: [{ source: 'doc.md', chunkIndex: 0, content: 'Fact' }] }),
        writer: async () => ({ draft: '# Approved Test Document' }),
        critic: async () => ({ critiqueHistory: [{ status: 'APPROVED', score: 9.2 }] }),
        humanApproval: createHumanApprovalNode({ outputDir: testOutputDir })
      }
    });

    const cfgA = { configurable: { thread_id: 'thread-approve' } };
    await testGraphApproved.invoke({ topic: 'Approval Test' }, cfgA);
    const resA = await testGraphApproved.invoke(new Command({ resume: { action: 'APPROVED' } }), cfgA);

    assert(resA.status === AgentStatus.COMPLETED, 'Resuming with APPROVED marks status as COMPLETED');
    assert(resA.humanDecision?.action === 'APPROVED', 'humanDecision.action is APPROVED');
    assert(resA.humanDecision?.savedPath && existsSync(resA.humanDecision.savedPath), 'Output document saved to disk on APPROVED');

    // 5B: EDITED
    const testGraphEdited = createMultiAgentGraph({
      checkpointer: new MemorySaver(),
      outputDir: testOutputDir,
      nodes: {
        researcher: async () => ({ facts: [] }),
        writer: async () => ({ draft: '# Base Draft' }),
        critic: async () => ({ critiqueHistory: [{ status: 'APPROVED', score: 8.5 }] }),
        humanApproval: createHumanApprovalNode({ outputDir: testOutputDir })
      }
    });

    const cfgE = { configurable: { thread_id: 'thread-edit' } };
    await testGraphEdited.invoke({ topic: 'Edit Test' }, cfgE);
    const resE = await testGraphEdited.invoke(
      new Command({ resume: { action: 'EDITED', notes: 'Addendum verified by security engineer.' } }),
      cfgE
    );

    assert(resE.status === AgentStatus.COMPLETED, 'Resuming with EDITED marks status as COMPLETED');
    assert(resE.draft.includes('Human Editorial Addendum'), 'Draft includes human editorial addendum');
    assert(resE.draft.includes('Addendum verified by security engineer.'), 'Draft includes custom notes');

    // 5C: REJECTED
    const testGraphRejected = createMultiAgentGraph({
      checkpointer: new MemorySaver(),
      outputDir: testOutputDir,
      nodes: {
        researcher: async () => ({ facts: [] }),
        writer: async () => ({ draft: '# Flawed Draft' }),
        critic: async () => ({ critiqueHistory: [{ status: 'APPROVED', score: 8.0 }] }),
        humanApproval: createHumanApprovalNode({ outputDir: testOutputDir })
      }
    });

    const cfgR = { configurable: { thread_id: 'thread-reject' } };
    await testGraphRejected.invoke({ topic: 'Rejection Test' }, cfgR);
    const resR = await testGraphRejected.invoke(new Command({ resume: { action: 'REJECTED' } }), cfgR);

    assert(resR.status === AgentStatus.REJECTED, 'Resuming with REJECTED marks status as REJECTED');
    assert(!resR.humanDecision?.savedPath, 'Rejected draft is not saved to output path');
  } catch (err) {
    assert(false, `Test 5 failed with error: ${err.message}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 6: Revision Cycle Execution (Simulated Writer/Critic Revision)
  // ──────────────────────────────────────────────────────────────────────────
  section('Test 6: Revision Cycle in Graph (Writer -> Critic -> Writer -> Critic)');
  try {
    let writerInvocations = 0;
    let criticInvocations = 0;

    const cycleGraph = createMultiAgentGraph({
      checkpointer: new MemorySaver(),
      outputDir: testOutputDir,
      nodes: {
        researcher: async () => ({ facts: [{ source: 'guide.md', chunkIndex: 0, content: 'Raft consensus' }] }),
        writer: async (state) => {
          writerInvocations++;
          const isRev = state.critiqueHistory.length > 0;
          return {
            draft: isRev ? '# Revised Draft\nFixed missing consensus details.' : '# Initial Draft',
            draftHistory: state.draft ? [state.draft] : [],
            iteration: isRev ? state.iteration + 1 : state.iteration,
            status: AgentStatus.DRAFTED
          };
        },
        critic: async (state) => {
          criticInvocations++;
          const isInitial = state.iteration === 0;
          return {
            critiqueHistory: [{
              status: isInitial ? 'REVISE' : 'APPROVED',
              score: isInitial ? 6.5 : 9.0,
              feedback: isInitial ? 'Need consensus details' : 'Approved'
            }],
            status: AgentStatus.CRITIQUED
          };
        },
        humanApproval: createHumanApprovalNode({ outputDir: testOutputDir })
      }
    });

    const cfgC = { configurable: { thread_id: 'thread-cycle' } };
    await cycleGraph.invoke({ topic: 'Consensus Protocols', maxIterations: 1 }, cfgC);

    // Should have invoked writer twice (initial + 1 revision) and critic twice
    assert(writerInvocations === 2, `Writer invoked 2 times (actual: ${writerInvocations})`);
    assert(criticInvocations === 2, `Critic invoked 2 times (actual: ${criticInvocations})`);

    const cycleSnapshot = await cycleGraph.getState(cfgC);
    assert(cycleSnapshot.values.iteration === 1, `Final iteration in state is 1 (actual: ${cycleSnapshot.values.iteration})`);
    assert(cycleSnapshot.values.draftHistory.length === 1, 'Draft history recorded previous draft');
    assert(cycleSnapshot.values.draft.includes('Revised Draft'), 'Final draft is the revised draft');

    // Resume to complete
    const finalRes = await cycleGraph.invoke(new Command({ resume: 'APPROVED' }), cfgC);
    assert(finalRes.status === AgentStatus.COMPLETED, 'Cycle graph completes successfully');
  } catch (err) {
    assert(false, `Test 6 failed with error: ${err.message}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 7: Live End-to-End Run with Gemini LLM
  // ──────────────────────────────────────────────────────────────────────────
  section('Test 7: Live End-to-End LangGraph Run with Gemini');
  try {
    if (!process.env.GEMINI_API_KEY) {
      console.log(`  ${C.yellow}⚠ SKIPPED${C.reset}: GEMINI_API_KEY not set`);
    } else {
      const liveGraph = createMultiAgentGraph({
        outputDir: testOutputDir
      });

      const liveCfg = { configurable: { thread_id: `live-${Date.now()}` } };
      console.log('  Invoking live graph through researcher, writer, critic...');
      await liveGraph.invoke(
        {
          topic: 'NebulaCloud consensus models and SLA guarantees',
          maxIterations: 1
        },
        liveCfg
      );

      const liveSnapshot = await liveGraph.getState(liveCfg);
      assert(liveSnapshot.values.facts.length > 0, `Live run retrieved ${liveSnapshot.values.facts.length} facts`);
      assert(liveSnapshot.values.draft.length > 100, `Live draft generated (${liveSnapshot.values.draft.length} chars)`);
      assert(liveSnapshot.values.critiqueHistory.length >= 1, `Critic provided ${liveSnapshot.values.critiqueHistory.length} review(s)`);

      // Resume from interrupt
      const liveFinal = await liveGraph.invoke(new Command({ resume: { action: 'APPROVED' } }), liveCfg);
      assert(liveFinal.status === AgentStatus.COMPLETED, 'Live pipeline completed successfully');
      assert(liveFinal.humanDecision?.savedPath && existsSync(liveFinal.humanDecision.savedPath), 'Live document saved to disk');
    }
  } catch (err) {
    assert(false, `Test 7 failed with error: ${err.message}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${C.bold}══════════════════════════════════════════════════════════${C.reset}`);
  console.log(`  ${C.bold}Results:${C.reset} ${C.green}${passed} Passed${C.reset} | ${failed > 0 ? `${C.red}${failed} Failed${C.reset}` : `${C.green}0 Failed${C.reset}`}`);
  console.log(`${C.bold}══════════════════════════════════════════════════════════${C.reset}\n`);

  // Clean up test output
  await rm(testOutputDir, { recursive: true, force: true });

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
