#!/usr/bin/env node
/**
 * Day 6 — LangGraph Multi-Agent Content Pipeline CLI
 *
 * Demonstrates:
 *   1. StateGraph with explicit State Schema (Annotation.Root)
 *   2. Linear delegation: [researcher] -> [writer] -> [critic]
 *   3. Conditional Edge: Critic revision cycle (loop back to [writer])
 *   4. Checkpointing (MemorySaver) and Human-in-the-Loop Interrupt
 *   5. State resumption with Command({ resume: decision })
 *
 * Usage:
 *   node run-graph.mjs "Architecture, SLA guarantees, and consensus in NebulaCloud"
 *   node run-graph.mjs --auto-approve
 *   node run-graph.mjs --reject
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import dotenv from 'dotenv';
import { Command } from '@langchain/langgraph';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env
dotenv.config({ path: join(__dirname, '.env') });
if (!process.env.GEMINI_API_KEY) {
  dotenv.config({ path: join(__dirname, '../Day4/.env') });
}
if (!process.env.GEMINI_API_KEY) {
  dotenv.config({ path: join(__dirname, '../Day3/.env') });
}

if (!process.env.GEMINI_API_KEY) {
  console.error('\x1b[31m✖ Error: GEMINI_API_KEY is not set. Please set it in .env\x1b[0m');
  process.exit(1);
}

import { createMultiAgentGraph } from './src/graph.mjs';

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
  console.log('\n' + c('bold', c('cyan', '╔════════════════════════════════════════════════════════════════════╗')));
  console.log(c('bold', c('cyan',       '║    🕸️  Day 6: LangGraph Multi-Agent Architecture with HITL Gate    ║')));
  console.log(c('bold', c('cyan',       '╚════════════════════════════════════════════════════════════════════╝')) + '\n');
}

async function promptHumanDecision(interruptValue) {
  // Check CLI arguments first
  if (process.argv.includes('--auto-approve') || process.argv.includes('-y')) {
    console.log(c('green', '⚡ [Auto-Approve Flag Detected] — Approving generated draft.'));
    return { action: 'APPROVED' };
  }
  if (process.argv.includes('--reject')) {
    console.log(c('red', '⚡ [Reject Flag Detected] — Rejecting generated draft.'));
    return { action: 'REJECTED' };
  }

  // Non-interactive fallback
  if (!process.stdin.isTTY) {
    console.log(c('dim', 'Non-interactive environment detected. Defaulting to APPROVED.'));
    return { action: 'APPROVED' };
  }

  const rl = createInterface({ input, output });

  console.log('\n' + '═'.repeat(65));
  console.log(' 🛑 LANGGRAPH HUMAN-IN-THE-LOOP CHECKPOINT INTERRUPT');
  console.log('═'.repeat(65));
  console.log(`Topic:           ${interruptValue.topic}`);
  console.log(`Total Revisions: ${interruptValue.iteration}`);
  if (interruptValue.lastCritique) {
    console.log(`Critic Score:    ${interruptValue.lastCritique.score}/10 (${interruptValue.lastCritique.status})`);
    console.log(`Critic Feedback: ${interruptValue.lastCritique.feedback}`);
  }
  console.log('─'.repeat(65));
  console.log('DRAFT PREVIEW:\n');
  console.log(interruptValue.draftPreview);
  console.log('─'.repeat(65));
  console.log('Actions:');
  console.log('  [A] Approve & Persist markdown to disk');
  console.log('  [E] Edit / Add human notes before persisting');
  console.log('  [R] Reject and discard draft');
  console.log('─'.repeat(65));

  try {
    const choice = (await rl.question('Choose action [A/E/R] (default A): ')).trim().toUpperCase() || 'A';
    if (choice === 'A') {
      rl.close();
      return { action: 'APPROVED' };
    } else if (choice === 'E') {
      console.log('\nEnter your custom editorial notes:');
      const notes = await rl.question('> ');
      rl.close();
      return { action: 'EDITED', notes };
    } else {
      rl.close();
      return { action: 'REJECTED' };
    }
  } catch (err) {
    rl.close();
    throw err;
  }
}

async function main() {
  printBanner();

  const args = process.argv.slice(2).filter(a => !a.startsWith('--') && !a.startsWith('-'));
  const topic = args.join(' ').trim() || 'Architecture, SLA guarantees, and consensus in NebulaCloud';
  const threadId = `run-${Date.now()}`;
  const config = { configurable: { thread_id: threadId } };

  console.log(`${c('bold', 'Topic:')}     ${c('yellow', topic)}`);
  console.log(`${c('bold', 'Thread ID:')} ${c('dim', threadId)}\n`);

  const outputDir = join(__dirname, 'output');
  const graph = createMultiAgentGraph({ outputDir });

  console.log(c('dim', '── Executing LangGraph Workflow ─────────────────────────────────'));

  const startTime = Date.now();

  // Stream node updates
  const stream = await graph.stream(
    {
      topic,
      maxIterations: 1
    },
    { ...config, streamMode: 'updates' }
  );

  for await (const update of stream) {
    for (const [nodeName, nodeState] of Object.entries(update)) {
      switch (nodeName) {
        case 'researcher':
          console.log(`  ${c('green', '✔ [researcher]')} Gathered ${nodeState.facts?.length || 0} facts.`);
          break;
        case 'writer':
          console.log(`  ${c('green', '✔ [writer]')} Compiled draft (Iteration ${nodeState.iteration ?? 0}, ${nodeState.draft?.length || 0} chars).`);
          break;
        case 'critic': {
          const critique = nodeState.critiqueHistory?.[nodeState.critiqueHistory.length - 1];
          const color = critique?.status === 'APPROVED' ? 'green' : 'yellow';
          console.log(`  ${c(color, '⚖ [critic]')} Verdict: ${c('bold', critique?.status || 'UNKNOWN')} (Score: ${critique?.score ?? 'N/A'}/10)`);
          break;
        }
        case 'humanApproval':
          console.log(`  ${c('magenta', '🛑 [humanApproval]')} Checkpoint reached.`);
          break;
      }
    }
  }

  // Check state snapshot after stream pauses
  const snapshot = await graph.getState(config);

  if (snapshot.next.length > 0 && snapshot.tasks.some(t => t.interrupts.length > 0)) {
    const interruptObj = snapshot.tasks.find(t => t.interrupts.length > 0)?.interrupts[0];
    const interruptVal = interruptObj?.value || snapshot.values;

    console.log(`\n  ${c('yellow', '⏸  Graph execution paused at checkpoint.')}`);

    const decision = await promptHumanDecision(interruptVal);

    console.log(`\n  ${c('cyan', '▶ Resuming graph with human decision:')} ${c('bold', decision.action)}...`);

    // Resume using LangGraph Command
    await graph.invoke(new Command({ resume: decision }), config);
  }

  const finalSnapshot = await graph.getState(config);
  const finalState = finalSnapshot.values;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n' + c('dim', '── Execution Complete ──────────────────────────────────────────'));
  console.log(`${c('bold', 'Final Status:')}      ${finalState.status === 'COMPLETED' ? c('green', finalState.status) : c('red', finalState.status)}`);
  console.log(`${c('bold', 'Total Revisions:')}   ${finalState.iteration}`);
  console.log(`${c('bold', 'Elapsed Time:')}      ${elapsed}s`);

  if (finalState.humanDecision?.savedPath) {
    console.log(`${c('bold', 'Saved Document:')}    ${c('cyan', finalState.humanDecision.savedPath)}`);
  }
}

main().catch(err => {
  console.error('\n\x1b[31m✖ Fatal error during execution:\x1b[0m', err);
  process.exit(1);
});
