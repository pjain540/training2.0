#!/usr/bin/env node
/**
 * Day 4 — Multi-Agent Content Pipeline CLI
 *
 * Coordinates:
 *   [Supervisor]
 *      ├── ResearcherAgent (Day-3 Grounded RAG)
 *      ├── WriterAgent (Drafting & Revisions)
 *      └── CriticAgent (Editorial audit, max 1 revision)
 *      └── HumanInTheLoopGate (Approval / Edit / Discard)
 *
 * Usage:
 *   node run-pipeline.mjs "What is the availability SLA and consensus model for NebulaCloud?"
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from Day4 or fallback to Day3
dotenv.config({ path: join(__dirname, '.env') });
if (!process.env.GEMINI_API_KEY) {
  dotenv.config({ path: join(__dirname, '../Day3/.env') });
}

if (!process.env.GEMINI_API_KEY) {
  console.error('\x1b[31m✖ Error: GEMINI_API_KEY is not set. Please add it to Day4/.env or Day3/.env\x1b[0m');
  process.exit(1);
}

import { PipelineSupervisor } from './src/supervisor.mjs';
import { HumanInTheLoopGate } from './src/hitl.mjs';

// ── Color Utilities ────────────────────────────────────────────────────────
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m'
};

const c = (color, str) => `${C[color]}${str}${C.reset}`;

function printBanner() {
  console.log('\n' + c('bold', c('cyan', '╔════════════════════════════════════════════════════════════════╗')));
  console.log(c('bold', c('cyan',       '║      🤖  Multi-Agent Orchestrator & HITL Pipeline — Day 4       ║')));
  console.log(c('bold', c('cyan',       '╚════════════════════════════════════════════════════════════════╝')) + '\n');
}

const defaultTopic = 'Architecture, SLA guarantees, and consensus in NebulaCloud';
const topic = process.argv.slice(2).join(' ').trim() || defaultTopic;

async function main() {
  printBanner();
  console.log(`${c('bold', 'Topic:')} ${c('yellow', topic)}\n`);

  const outputDir = join(__dirname, 'output');
  await mkdir(outputDir, { recursive: true });

  const supervisor = new PipelineSupervisor();
  const hitlGate = new HumanInTheLoopGate();

  console.log(c('dim', '── Step-by-Step Multi-Agent Execution ─────────────────────────'));

  const startTime = Date.now();

  // Run the multi-agent orchestration
  const state = await supervisor.run(topic, (stepName, currentState) => {
    switch (stepName) {
      case 'START':
        console.log(`  ${c('blue', '▶ [Supervisor]')} Pipeline initialized.`);
        break;
      case 'RESEARCH_COMPLETE':
        console.log(`  ${c('green', '✔ [Researcher]')} Retrieved ${currentState.facts.length} facts from knowledge store.`);
        break;
      case 'DRAFT_COMPLETE':
        console.log(`  ${c('green', '✔ [Writer]')} Initial draft compiled (${currentState.draft.length} chars).`);
        break;
      case 'CRITIQUE_COMPLETE': {
        const lastCritique = currentState.critiqueHistory[currentState.critiqueHistory.length - 1];
        const verdictColor = lastCritique.status === 'APPROVED' ? 'green' : 'yellow';
        console.log(`  ${c(verdictColor, `⚖ [Critic]`)} Verdict: ${c('bold', lastCritique.status)} (Score: ${lastCritique.score}/10)`);
        break;
      }
      case 'REVISION_DRAFT_COMPLETE':
        console.log(`  ${c('green', '✔ [Writer]')} Revision compiled addressing feedback.`);
        break;
      case 'REVISION_CRITIQUE_COMPLETE': {
        const lastCritique = currentState.critiqueHistory[currentState.critiqueHistory.length - 1];
        console.log(`  ${c('green', `⚖ [Critic]`)} Post-revision Verdict: ${c('bold', lastCritique.status)} (Score: ${lastCritique.score}/10)`);
        break;
      }
      case 'HITL_READY':
        console.log(`  ${c('magenta', '★ [Supervisor]')} Handing off to Human Approval Gate.\n`);
        break;
    }
  });

  const latency = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(c('dim', `  Multi-agent convergence completed in ${latency}s\n`));

  // Prompt human
  const result = await hitlGate.promptHuman(state, outputDir);

  console.log('\n' + c('dim', '── Final Execution Summary ────────────────────────────────────'));
  console.log(`  Decision:       ${c('bold', state.humanDecision?.action || 'NONE')}`);
  if (result.savedPath) {
    console.log(`  Saved File:     ${c('green', result.savedPath)}`);
  }
  console.log(`  Total Loops:    ${state.iteration}`);
  console.log(`  Audit Logs:     ${state.logs.length} logged events`);
  console.log(c('dim', '───────────────────────────────────────────────────────────────\n'));
}

main().catch(err => {
  console.error('\n' + c('red', `✖ Fatal Pipeline Error: ${err.message}`));
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
