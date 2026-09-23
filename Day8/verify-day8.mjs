#!/usr/bin/env node
/**
 * Day 8 Capstone Verification Suite
 *
 * Validates:
 *   Test 1: SQLite Operations Database & Initial Seeding
 *   Test 2: RAG Vector Store & Incident Retriever (Citations, Similarity, Filtering)
 *   Test 3: MCP Server & Client Tool Discovery and Invocation
 *   Test 4: Answer Quality Evaluator (Grounding, Policy Ceiling, Completeness)
 *   Test 5: LangGraph HITL Interrupt at Operator Gate
 *   Test 6: HITL Resumption with APPROVED Decision (MCP Tool Mutation)
 *   Test 7: HITL Resumption with REJECTED Decision (Safe Abort & Audit Log)
 *   Test 8: End-to-End Multi-Agent State Integrity & Final Resolution Report
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Command } from '@langchain/langgraph';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

import { OperationsDatabase } from './src/mcp/db.mjs';
import { createOperationsServer } from './src/mcp/server.mjs';
import { OperationsMCPClient } from './src/mcp/client.mjs';
import { IncidentRetriever } from './src/rag/retriever.mjs';
import { QualityEvaluator } from './src/eval/quality-evaluator.mjs';
import { createOperationsGraph } from './src/agent/graph.mjs';
import { AgentStatus } from './src/agent/state.mjs';

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

async function runVerification() {
  console.log('\n' + C.bold + C.cyan + '╔════════════════════════════════════════════════════════════════════════╗' + C.reset);
  console.log(C.bold + C.cyan +         '║        DAY 8 CAPSTONE: MULTI-AGENT RAG & MCP VERIFICATION SUITE       ║' + C.reset);
  console.log(C.bold + C.cyan +         '╚════════════════════════════════════════════════════════════════════════╝' + C.reset + '\n');

  const testDbPath = join(__dirname, 'data/test_verify.db');
  if (existsSync(testDbPath)) {
    unlinkSync(testDbPath);
  }

  // ── TEST 1: SQLite Operations Database Engine ───────────────────────────
  console.log(C.bold + 'Test 1: SQLite Operations Database Engine & Schema' + C.reset);
  const db = new OperationsDatabase(testDbPath);
  await db.init();
  const tables = db.getSchema();
  assert(tables.length >= 3, `Database initialized with core tables (found ${tables.length})`);
  const initialIncidents = db.query(`SELECT * FROM incidents WHERE ticket_number = 'INC-8091'`);
  assert(initialIncidents.length === 1 && initialIncidents[0].status === 'OPEN', 'Initial incident INC-8091 is seeded and OPEN');

  // ── TEST 2: RAG Vector Store & Incident Retriever ────────────────────────
  console.log(C.bold + '\nTest 2: RAG Vector Store & Incident Retriever' + C.reset);
  const retriever = new IncidentRetriever({ useRemoteEmbedding: false });
  await retriever.init();
  const ragResult = await retriever.retrieve('database latency spike SLA service credit', { topK: 2 });
  assert(Array.isArray(ragResult.hits) && ragResult.hits.length === 2, 'RAG retrieves top-2 relevant chunks');
  assert(ragResult.citations.length === 2 && ragResult.citations[0].citationId === '[REF-1]', 'Formats standard citation IDs [REF-1], [REF-2]');
  assert(ragResult.hits.some(h => h.id.includes('POLICY') || h.id.includes('RUNBOOK')), 'Retrieves grounded runbook/policy documents');

  // ── TEST 3: MCP Server & Client Tool Discovery and Execution ────────────
  console.log(C.bold + '\nTest 3: MCP Server & Client Protocol Integration' + C.reset);
  const { server } = createOperationsServer(db);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcpClient = new OperationsMCPClient({ transport: clientTransport });
  await mcpClient.connect();

  const tools = await mcpClient.listTools();
  assert(tools.some(t => t.name === 'query_system_state'), 'Exposes MCP tool: query_system_state');
  assert(tools.some(t => t.name === 'execute_resolution_action'), 'Exposes MCP tool: execute_resolution_action');
  assert(tools.some(t => t.name === 'record_audit_log'), 'Exposes MCP tool: record_audit_log');

  const resources = await mcpClient.listResources();
  assert(resources.some(r => r.uri === 'incident://active'), 'Exposes MCP resource: incident://active');

  const queryRes = await mcpClient.callTool('query_system_state', {
    sql: 'SELECT * FROM customers WHERE id = 1'
  });
  assert(!queryRes.isError && queryRes.content.includes('Acme Global'), 'MCP tool query_system_state returns customer record');

  // ── TEST 4: Answer Quality Evaluator ─────────────────────────────────────
  console.log(C.bold + '\nTest 4: Answer Quality Evaluator' + C.reset);
  const evaluator = new QualityEvaluator({ passingThreshold: 70 });

  // Valid grounded answer
  const validEval = evaluator.evaluate({
    ticket: { ticket_number: 'INC-8091', service_impact_minutes: 90 },
    retrievedDocs: ragResult.hits,
    citations: ragResult.citations,
    diagnosisDraft: 'Verified 90 minutes latency degradation for Acme Global under Enterprise SLA [REF-1]. Applying standard service credit [REF-2].',
    proposedAction: {
      ticketNumber: 'INC-8091',
      actionType: 'APPLY_SLA_CREDIT',
      creditAmount: 350.0,
      notes: 'Applying 10% SLA credit per [REF-1]'
    }
  });
  assert(validEval.passed === true && validEval.score >= 70, `High quality grounded answer passes evaluation (Score: ${validEval.score}/100)`);
  assert(validEval.citationsValid === true, 'Validates citation integrity in answer');

  // Invalid policy violation answer (excessive credit > $500 cap)
  const invalidEval = evaluator.evaluate({
    ticket: { ticket_number: 'INC-8091' },
    retrievedDocs: ragResult.hits,
    citations: [],
    diagnosisDraft: 'Issue resolved with no reference.',
    proposedAction: {
      ticketNumber: 'INC-8091',
      actionType: 'APPLY_SLA_CREDIT',
      creditAmount: 2500.0, // Exceeds ceiling
      notes: 'Unchecked compensation'
    }
  });
  assert(invalidEval.passed === false, `Unauthorized credit amount ($2500) fails policy compliance check (Score: ${invalidEval.score}/100)`);

  // ── TEST 5: LangGraph Checkpointed StateGraph & HITL Interrupt ───────────
  console.log(C.bold + '\nTest 5: LangGraph Checkpointed StateGraph & HITL Interrupt' + C.reset);
  const { app } = createOperationsGraph({ mcpClient, retriever, evaluator });
  const threadId = 'test-thread-hitl-1';
  const config = { configurable: { thread_id: threadId } };

  // Run graph up to the interrupt
  await app.invoke({ ticket: { ticket_number: 'INC-8091' } }, config);
  const snapshotAtInterrupt = await app.getState(config);

  assert(snapshotAtInterrupt.tasks.length > 0 && snapshotAtInterrupt.tasks[0].interrupts.length > 0, 'LangGraph checkpoints and interrupts execution at human gate');
  const interruptVal = snapshotAtInterrupt.tasks[0].interrupts[0].value;
  assert(interruptVal.ticketNumber === 'INC-8091', 'Interrupt payload contains incident ticket details');
  assert(interruptVal.proposedAction && interruptVal.proposedAction.actionType === 'APPLY_SLA_CREDIT', 'Interrupt payload includes proposed action');

  // ── TEST 6: Resuming with APPROVED Decision (MCP Tool Mutation) ───────────
  console.log(C.bold + '\nTest 6: HITL Resumption with APPROVED Decision (MCP Tool Mutation)' + C.reset);
  const approvalDecision = {
    action: 'APPROVED',
    approvedBy: 'SRE_Lead_Alice',
    notes: 'Outage verified against telemetry metrics'
  };

  const approvedResult = await app.invoke(new Command({ resume: approvalDecision }), config);
  assert(approvedResult.status === AgentStatus.COMPLETED, 'Graph completes successfully upon human approval');
  assert(approvedResult.mcpExecutionResult && approvedResult.mcpExecutionResult.success === true, 'Executor Agent successfully invokes MCP tool execute_resolution_action');
  assert(approvedResult.finalAnswer.includes('Incident Resolution Report'), 'Final report synthesizes resolution, citations, and evaluation');

  // Verify in SQLite database that the record is now RESOLVED with credit awarded
  const updatedIncident = db.query(`SELECT status, credit_awarded, remediation_action FROM incidents WHERE ticket_number = 'INC-8091'`)[0];
  assert(updatedIncident.status === 'RESOLVED', 'Database incident status updated to RESOLVED via MCP tool');
  assert(updatedIncident.credit_awarded > 0, `Database reflects awarded credit ($${updatedIncident.credit_awarded})`);

  // ── TEST 7: Resuming with REJECTED Decision (Safe Abort) ─────────────────
  console.log(C.bold + '\nTest 7: HITL Resumption with REJECTED Decision (Safe Abort & Audit Log)' + C.reset);
  const threadIdReject = 'test-thread-reject-2';
  const configReject = { configurable: { thread_id: threadIdReject } };

  await app.invoke({ ticket: { ticket_number: 'INC-8092' } }, configReject);
  const rejectDecision = {
    action: 'REJECTED',
    approvedBy: 'SRE_Lead_Bob',
    notes: 'Degradation was under 30 minute minimum SLA threshold'
  };

  const rejectResult = await app.invoke(new Command({ resume: rejectDecision }), configReject);
  assert(rejectResult.status === AgentStatus.REJECTED, 'Graph transitions to REJECTED status upon human denial');
  assert(rejectResult.mcpExecutionResult === null, 'MCP write remediation tool is NOT invoked when rejected');

  // Check audit log contains rejection
  const auditLogs = db.query(`SELECT * FROM audit_logs WHERE ticket_number = 'INC-8092'`);
  assert(auditLogs.length > 0 && auditLogs[0].action_type === 'HUMAN_REJECTION', 'Compliance audit log records rejection with operator notes');

  // ── TEST 8: State Integrity & Citations in Report ────────────────────────
  console.log(C.bold + '\nTest 8: End-to-End State Integrity & Citations in Report' + C.reset);
  assert(approvedResult.citations.length > 0, 'State preserves RAG citations throughout agent delegation');
  assert(approvedResult.logs.length >= 5, 'Agent blackboard records structured append logs across all nodes');

  await mcpClient.close();

  // Summary
  console.log('\n' + C.cyan + '═'.repeat(60) + C.reset);
  console.log(C.bold + `VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED` + C.reset);
  console.log(C.cyan + '═'.repeat(60) + C.reset + '\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runVerification().catch(err => {
  console.error('\n✖ Unhandled Verification Error:', err);
  process.exit(1);
});
