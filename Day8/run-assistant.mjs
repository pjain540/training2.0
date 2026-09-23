#!/usr/bin/env node
/**
 * Day 8 — Enterprise Operations Assistant CLI Runner
 *
 * Usage:
 *   node run-assistant.mjs
 *   node run-assistant.mjs INC-8092
 *   node run-assistant.mjs --auto-approve
 *   node run-assistant.mjs --reject
 */

import { Command } from '@langchain/langgraph';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createOperationsServer } from './src/mcp/server.mjs';
import { OperationsMCPClient } from './src/mcp/client.mjs';
import { IncidentRetriever } from './src/rag/retriever.mjs';
import { QualityEvaluator } from './src/eval/quality-evaluator.mjs';
import { createOperationsGraph } from './src/agent/graph.mjs';
import { OperationsDatabase } from './src/mcp/db.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  green:   '\x1b[32m',
  red:     '\x1b[31m',
  cyan:    '\x1b[36m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m'
};

const c = (col, text) => `${C[col]}${text}${C.reset}`;

async function main() {
  const args = process.argv.slice(2);
  const ticketArg = args.find(a => !a.startsWith('-')) || 'INC-8091';

  console.log('\n' + c('bold', c('cyan', '╔════════════════════════════════════════════════════════════════════════╗')));
  console.log(c('bold', c('cyan',       '║           OPERATIONS ASSISTANT: MULTI-AGENT TRIAGE & HITL GATE         ║')));
  console.log(c('bold', c('cyan',       '╚════════════════════════════════════════════════════════════════════════╝')) + '\n');

  // Initialize MCP
  const db = new OperationsDatabase();
  await db.init();
  const { server } = createOperationsServer(db);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcpClient = new OperationsMCPClient({ transport: clientTransport });
  await mcpClient.connect();

  const retriever = new IncidentRetriever();
  const evaluator = new QualityEvaluator({ passingThreshold: 70 });
  const { app } = createOperationsGraph({ mcpClient, retriever, evaluator });

  const threadId = `ticket-session-${Date.now()}`;
  const config = { configurable: { thread_id: threadId } };

  console.log(`Processing ticket: ${c('bold', ticketArg)}...\n`);

  for await (const chunk of await app.stream({ ticket: { ticket_number: ticketArg } }, { ...config, streamMode: 'updates' })) {
    const nodeName = Object.keys(chunk)[0];
    const update = chunk[nodeName];
    if (update?.logs) {
      update.logs.forEach(log => console.log(`   ${c('dim', log)}`));
    }
  }

  // Handle HITL Interrupt
  const stateSnapshot = await app.getState(config);
  if (stateSnapshot.tasks?.[0]?.interrupts?.length > 0) {
    const interruptValue = stateSnapshot.tasks[0].interrupts[0].value;
    console.log('\n' + c('yellow', '═'.repeat(68)));
    console.log(c('bold', c('yellow', ' 🛑 OPERATOR APPROVAL REQUIRED')));
    console.log(c('yellow', '═'.repeat(68)));
    console.log(`Ticket:          ${interruptValue.ticketNumber} (${interruptValue.customer})`);
    console.log(`Diagnosis:       ${interruptValue.diagnosis}`);
    console.log(`Action:          ${interruptValue.proposedAction.actionType} ($${interruptValue.proposedAction.creditAmount})`);
    console.log(`Quality Score:   ${interruptValue.evaluation.score}/100 (${interruptValue.evaluation.passed ? 'PASSED' : 'FLAGGED'})`);
    console.log(c('yellow', '─'.repeat(68)));

    let decision = { action: 'APPROVED', approvedBy: 'Lead_Operator', notes: 'Approved via assistant CLI' };

    if (args.includes('--reject')) {
      decision = { action: 'REJECTED', approvedBy: 'Lead_Operator', notes: 'Rejected via --reject CLI flag' };
    } else if (args.includes('--auto-approve') || !process.stdin.isTTY) {
      decision = { action: 'APPROVED', approvedBy: 'Lead_Operator', notes: 'Approved via --auto-approve' };
    } else {
      const rl = createInterface({ input, output });
      const ans = await rl.question('\nAuthorize resolution action? ([A]pprove / [R]eject): ');
      rl.close();
      if (ans.trim().toLowerCase().startsWith('r')) {
        decision = { action: 'REJECTED', approvedBy: 'Lead_Operator', notes: 'Operator rejected in prompt' };
      }
    }

    console.log(`\nResuming with decision: ${c('bold', decision.action)}...\n`);
    for await (const chunk of await app.stream(new Command({ resume: decision }), { ...config, streamMode: 'updates' })) {
      const nodeName = Object.keys(chunk)[0];
      const update = chunk[nodeName];
      if (update?.logs) {
        update.logs.forEach(log => console.log(`   ${c('dim', log)}`));
      }
    }
  }

  const finalState = await app.getState(config);
  console.log('\n' + c('cyan', '─'.repeat(68)));
  console.log(finalState.values.finalAnswer);
  console.log(c('cyan', '─'.repeat(68)));

  await mcpClient.close();
}

main().catch(err => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
