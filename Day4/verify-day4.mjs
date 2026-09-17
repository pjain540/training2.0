#!/usr/bin/env node
/**
 * Day 4 — Automated Test Suite & Multi-Agent Verification
 *
 * Tests:
 * 1. State Model & Serialization (Blackboard Pattern)
 * 2. ResearcherAgent + Day-3 RAG Integration
 * 3. WriterAgent drafting & citation adherence
 * 4. CriticAgent JSON rubric evaluation
 * 5. Supervisor finite-state loop & max iteration enforcement
 * 6. HumanInTheLoopGate (Approved, Edited, Rejected pathways)
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, unlink, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env
dotenv.config({ path: join(__dirname, '.env') });
if (!process.env.GEMINI_API_KEY) {
  dotenv.config({ path: join(__dirname, '../Day3/.env') });
}

import { PipelineState, AgentStatus } from './src/state.mjs';
import { ResearcherAgent } from './src/agents/researcher.mjs';
import { WriterAgent } from './src/agents/writer.mjs';
import { CriticAgent } from './src/agents/critic.mjs';
import { PipelineSupervisor } from './src/supervisor.mjs';
import { HumanInTheLoopGate } from './src/hitl.mjs';

// ── Test Output Styling ───────────────────────────────────────────────────
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
    console.log(`  ${C.green}✔${C.reset} ${label}`);
    passed++;
  } else {
    console.log(`  ${C.red}✖ FAIL${C.reset}: ${label}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${C.bold}${C.cyan}━━ ${title} ━━${C.reset}`);
}

async function runAllTests() {
  console.log(`\n${C.bold}🧪 Running Day 4 Multi-Agent Verification Suite...${C.reset}`);
  const testOutputDir = join(__dirname, '.test_output');
  await mkdir(testOutputDir, { recursive: true });

  const testCleanupFiles = [];

  try {
    // ── Test 1: State Model ─────────────────────────────────────────────
    section('1. Central State Model (Blackboard Pattern)');
    const state = new PipelineState('Distributed Consensus in Cloud Systems', { maxIterations: 1 });
    assert(state.topic === 'Distributed Consensus in Cloud Systems', 'State preserves topic');
    assert(state.status === AgentStatus.INITIALIZED, 'Initial status is INITIALIZED');
    assert(state.iteration === 0, 'Iteration begins at 0');
    assert(state.maxIterations === 1, 'Max iterations correctly capped at 1');

    state.log('TestAgent', 'Test execution logged');
    assert(state.logs.length === 1 && state.logs[0].includes('TestAgent'), 'Log formatting tracks agent and message');

    const jsonState = state.toJSON();
    assert(typeof jsonState === 'object' && jsonState.topic === state.topic, 'State serializes to JSON object correctly');

    // ── Test 2: Researcher Agent ────────────────────────────────────────
    section('2. Researcher Agent & Day-3 RAG Integration');
    const researcher = new ResearcherAgent();
    await researcher.run(state);

    assert(state.status === AgentStatus.RESEARCHED, 'State transitions to RESEARCHED');
    assert(Array.isArray(state.facts) && state.facts.length > 0, `Researcher retrieved ${state.facts.length} facts`);
    assert(state.facts[0].content && state.facts[0].source, 'Facts contain source and content fields');
    assert(state.citations.length > 0, 'Citations array populated');

    // ── Test 3: Writer Agent ────────────────────────────────────────────
    section('3. Writer Agent Drafting & Revision');
    const writer = new WriterAgent();
    await writer.run(state);

    assert(state.status === AgentStatus.DRAFTED, 'State transitions to DRAFTED');
    assert(typeof state.draft === 'string' && state.draft.length > 100, `Writer produced complete draft (${state.draft.length} chars)`);
    assert(state.draft.includes('#'), 'Draft contains Markdown headings');

    // ── Test 4: Critic Agent ────────────────────────────────────────────
    section('4. Critic Agent Structured JSON Evaluation');
    const critic = new CriticAgent();
    const critique = await critic.run(state);

    assert(state.status === AgentStatus.CRITIQUED, 'State transitions to CRITIQUED');
    assert(critique.status === 'APPROVED' || critique.status === 'REVISE', `Critic returned valid verdict: "${critique.status}"`);
    assert(typeof critique.score === 'number' && critique.score >= 1 && critique.score <= 10, `Critic score is valid number (${critique.score}/10)`);
    assert(Array.isArray(critique.strengths), 'Critique includes strengths array');
    assert(state.critiqueHistory.length === 1, 'Critique appended to state history');

    // ── Test 5: Supervisor Convergence & Bounds ─────────────────────────
    section('5. Supervisor Orchestration & 1-Revision Loop Bounds');
    const supervisor = new PipelineSupervisor({ maxRevisions: 1 });
    const supervisedState = await supervisor.run('NebulaCloud SLA and Consensus');

    assert(supervisedState.status === AgentStatus.HITL_PENDING, 'Supervisor halts at HITL_PENDING');
    assert(supervisedState.iteration <= 1, `Supervisor strictly honors max 1 revision cycle (iterations: ${supervisedState.iteration})`);
    assert(supervisedState.draft.length > 100, 'Supervisor pipeline produced final draft');
    assert(supervisedState.critiqueHistory.length >= 1, 'Supervisor collected critique history');
    assert(supervisedState.facts.length > 0, 'Supervisor pipeline preserved facts throughout pass');

    // ── Test 6: Human-In-The-Loop Gate ──────────────────────────────────
    section('6. Human-In-The-Loop (HITL) Programmatic Gate');
    const hitl = new HumanInTheLoopGate();

    // 6a: Test Approval Path
    const approveResult = await hitl.applyDecision(supervisedState, { action: 'APPROVED' }, testOutputDir);
    assert(approveResult.success === true, 'HITL approves draft successfully');
    assert(existsSync(approveResult.savedPath), 'Approved draft persisted to disk');
    testCleanupFiles.push(approveResult.savedPath);

    const savedContent = await readFile(approveResult.savedPath, 'utf-8');
    assert(savedContent.includes('human_decision: "APPROVED"'), 'Frontmatter contains human_decision metadata');
    assert(savedContent.includes(supervisedState.topic), 'Frontmatter contains topic title');

    // 6b: Test Edit-Before-Save Path
    const editResult = await hitl.applyDecision(
      supervisedState,
      { action: 'EDITED', notes: 'Approved after verification by SRE Lead.' },
      testOutputDir
    );
    assert(editResult.success === true, 'HITL edits & saves draft successfully');
    testCleanupFiles.push(editResult.savedPath);

    const editedSavedContent = await readFile(editResult.savedPath, 'utf-8');
    assert(editedSavedContent.includes('Human Editorial Addendum'), 'Saved content includes human notes addendum');
    assert(editedSavedContent.includes('Approved after verification by SRE Lead.'), 'Addendum note correctly recorded');

    // 6c: Test Reject Path
    const rejectResult = await hitl.applyDecision(supervisedState, { action: 'REJECTED' }, testOutputDir);
    assert(rejectResult.success === false, 'HITL handles rejection cleanly');
    assert(supervisedState.status === AgentStatus.REJECTED, 'State transitions to REJECTED');

  } catch (err) {
    console.error(`\n${C.red}✖ Exception in test runner:${C.reset}`, err);
    failed++;
  } finally {
    // Cleanup temporary test files
    for (const f of testCleanupFiles) {
      try {
        if (existsSync(f)) await unlink(f);
      } catch {}
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${C.bold}${C.cyan}━━ Test Summary ━━${C.reset}`);
  console.log(`  ${C.green}✔ Passed : ${passed}${C.reset}`);
  if (failed > 0) {
    console.log(`  ${C.red}✖ Failed : ${failed}${C.reset}\n`);
    process.exit(1);
  } else {
    console.log(`  ${C.green}${C.bold}All Day 4 Multi-Agent tests passed successfully! 🚀${C.reset}\n`);
    process.exit(0);
  }
}

runAllTests();
