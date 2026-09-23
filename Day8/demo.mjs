#!/usr/bin/env node
/**
 * Day 8 Capstone Demo Script
 * Demonstrates:
 * 1. RAG retrieval with citations
 * 2. Multi-agent reasoning across triage, quality evaluator, and executor
 * 3. Answer quality evaluation scorecard (grounding, policy compliance, completeness)
 * 4. Model Context Protocol (MCP) tool integration
 * 5. Checkpointed Human-in-the-Loop (HITL) approval gate
 */

import { Command } from '@langchain/langgraph';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createOperationsServer } from './src/mcp/server.mjs';
import { OperationsMCPClient } from './src/mcp/client.mjs';
import { IncidentRetriever } from './src/rag/retriever.mjs';
import { QualityEvaluator } from './src/eval/quality-evaluator.mjs';
import { createOperationsGraph } from './src/agent/graph.mjs';
import { OperationsDatabase } from './src/mcp/db.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Color formatting
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  green:   '\x1b[32m',
  red:     '\x1b[31m',
  cyan:    '\x1b[36m',
  yellow:  '\x1b[33m',
  magenta: '\x1b[35m',
  blue:    '\x1b[34m'
};

const c = (col, text) => `${C[col]}${text}${C.reset}`;

async function main() {
  console.log('\n' + c('bold', c('cyan', '╔════════════════════════════════════════════════════════════════════════╗')));
  console.log(c('bold', c('cyan',       '║   🚀 DAY 8 CAPSTONE: MULTI-AGENT RAG ASSISTANT WITH MCP & HITL GATE   ║')));
  console.log(c('bold', c('cyan',       '╚════════════════════════════════════════════════════════════════════════╝')) + '\n');

  // 1. Initialize MCP Server and Client using in-memory transport for seamless demo
  console.log(c('bold', '1. Connecting to Operations Model Context Protocol (MCP) Server...'));
  const demoDb = new OperationsDatabase(join(__dirname, 'data/demo_operations.db'));
  await demoDb.init();

  const { server } = createOperationsServer(demoDb);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const mcpClient = new OperationsMCPClient({ transport: clientTransport });
  await mcpClient.connect();

  const tools = await mcpClient.listTools();
  console.log(`   ${c('green', '✔')} MCP Connected. Discovered ${tools.length} tools: ${tools.map(t => t.name).join(', ')}`);

  // 2. Initialize RAG Knowledge Retriever
  console.log(c('bold', '\n2. Initializing RAG Knowledge Store & Runbooks...'));
  const retriever = new IncidentRetriever();
  await retriever.init();
  console.log(`   ${c('green', '✔')} Indexed operations runbooks, SLA policies, and compliance matrices.`);

  // 3. Create LangGraph Workflow
  console.log(c('bold', '\n3. Compiling LangGraph Multi-Agent Architecture...'));
  const evaluator = new QualityEvaluator({ passingThreshold: 70 });
  const { app } = createOperationsGraph({ mcpClient, retriever, evaluator });
  console.log(`   ${c('green', '✔')} StateGraph compiled with MemorySaver checkpointer.`);

  // 4. Run Graph up to Human-in-the-Loop Interrupt
  const threadId = `capstone-demo-${Date.now()}`;
  const config = { configurable: { thread_id: threadId } };
  const initialTicket = { ticket_number: 'INC-8091' };

  console.log(c('bold', `\n4. Starting Incident Triage for Ticket: ${initialTicket.ticket_number}...`));

  let interruptState = null;
  for await (const chunk of await app.stream({ ticket: initialTicket }, { ...config, streamMode: 'updates' })) {
    const nodeName = Object.keys(chunk)[0];
    const update = chunk[nodeName];
    if (update?.logs) {
      update.logs.forEach(log => console.log(`   ${c('dim', log)}`));
    }
  }

  // 5. Inspect State at Interrupt
  const stateSnapshot = await app.getState(config);

  if (stateSnapshot.tasks && stateSnapshot.tasks.length > 0 && stateSnapshot.tasks[0].interrupts?.length > 0) {
    const interruptValue = stateSnapshot.tasks[0].interrupts[0].value;
    console.log('\n' + c('yellow', '═'.repeat(72)));
    console.log(c('bold', c('yellow', ' 🛑 LANGGRAPH CHECKPOINT HITL INTERRUPT: OPERATOR SIGN-OFF REQUIRED')));
    console.log(c('yellow', '═'.repeat(72)));
    console.log(`   ${c('bold', 'Incident Ticket')}:    ${interruptValue.ticketNumber}`);
    console.log(`   ${c('bold', 'Customer')}:           ${interruptValue.customer}`);
    console.log(`   ${c('bold', 'Severity')}:           ${interruptValue.severity}`);
    console.log(`   ${c('bold', 'Diagnosis')}:          ${interruptValue.diagnosis}`);
    console.log(`   ${c('bold', 'Proposed Action')}:    ${interruptValue.proposedAction.actionType} ($${interruptValue.proposedAction.creditAmount})`);
    console.log(`   ${c('bold', 'Quality Score')}:      ${interruptValue.evaluation.score}/100 (${interruptValue.evaluation.passed ? c('green', 'PASSED') : c('red', 'FLAGGED')})`);
    console.log(`   ${c('bold', 'RAG Citations')}:      ${interruptValue.citations.map(cit => `${cit.citationId} (${cit.docId})`).join(', ')}`);
    console.log(c('yellow', '─'.repeat(72)));

    // 6. Resolve Decision
    let decision = { action: 'APPROVED', approvedBy: 'Lead_SRE_Operator', notes: 'Verified SLA clause and approved service credit' };

    if (process.argv.includes('--reject')) {
      console.log(c('red', '\n⚡ [--reject flag detected] Human Operator rejected proposed action.'));
      decision = { action: 'REJECTED', approvedBy: 'Lead_SRE_Operator', notes: 'Operator determined outage cause requires further investigation' };
    } else if (process.argv.includes('--auto-approve') || !process.stdin.isTTY) {
      console.log(c('green', '\n⚡ [--auto-approve flag detected] Human Operator APPROVED proposed action.'));
    } else {
      const rl = createInterface({ input, output });
      const ans = await rl.question('\nAuthorize resolution action? ([A]pprove / [R]eject): ');
      rl.close();
      if (ans.trim().toLowerCase().startsWith('r')) {
        decision = { action: 'REJECTED', approvedBy: 'Lead_SRE_Operator', notes: 'Operator manually rejected via CLI prompt' };
      } else {
        decision = { action: 'APPROVED', approvedBy: 'Lead_SRE_Operator', notes: 'Operator approved via interactive CLI' };
      }
    }

    // 7. Resume Graph Execution with Decision
    console.log(c('bold', '\n5. Resuming LangGraph Execution with Human Decision...'));
    for await (const chunk of await app.stream(new Command({ resume: decision }), { ...config, streamMode: 'updates' })) {
      const nodeName = Object.keys(chunk)[0];
      const update = chunk[nodeName];
      if (update?.logs) {
        update.logs.forEach(log => console.log(`   ${c('dim', log)}`));
      }
    }
  }

  // 8. Print Final State and Report
  const finalState = await app.getState(config);
  console.log('\n' + c('cyan', '═'.repeat(72)));
  console.log(c('bold', c('cyan', '                     FINAL RESOLUTION SUMMARY                     ')));
  console.log(c('cyan', '═'.repeat(72)));
  console.log(finalState.values.finalAnswer);

  // 9. Inspect Database via MCP Tool to prove persistence
  console.log(c('bold', '6. Verifying Database State via MCP Read Tool (query_system_state)...'));
  const verifyDb = await mcpClient.callTool('query_system_state', {
    sql: `SELECT ticket_number, status, credit_awarded, remediation_action FROM incidents WHERE ticket_number = ?`,
    params: [initialTicket.ticket_number]
  });
  console.log(verifyDb.content);

  console.log(c('bold', '7. Verifying Compliance Audit Trail via MCP Resource (audit://log)...'));
  const auditRes = await mcpClient.readResource('audit://log');
  console.log(auditRes.contents[0].text);

  await mcpClient.close();
  console.log('\n' + c('green', '✨ Day 8 Capstone Demo completed successfully!\n'));
}

main().catch(err => {
  console.error('\n✖ Demo Error:', err);
  process.exit(1);
});
