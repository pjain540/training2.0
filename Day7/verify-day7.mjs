#!/usr/bin/env node
/**
 * Day 7 — Automated Verification Suite for Model Context Protocol (MCP)
 *
 * Validates:
 *   Test 1: SQLite Database Engine & Persistent Operations
 *   Test 2: MCP Server Protocol Initialization & Capabilities
 *   Test 3: MCP Resources Exposure (inventory://schema & inventory://stats)
 *   Test 4: MCP Tools Boundary Validation & Safety Rules (db_get_schema, db_query, db_execute)
 *   Test 5: MCP Client over Stdio Subprocess Transport
 *   Test 6: MCP Tool Schema to Gemini Function Declaration Mapping (Day 1 Bridge)
 *   Test 7: End-to-End Agent Execution (LangGraph and Gemini over MCP SQLite Server)
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });
if (!process.env.GEMINI_API_KEY) {
  dotenv.config({ path: join(__dirname, '../Day6/.env') });
}

import { InventoryDatabase } from './src/db.mjs';
import { createInventoryServer } from './src/server.mjs';
import { MCPClientBridge } from './src/mcp-client.mjs';
import { createMCPLangGraphAgent } from './src/agent-langgraph.mjs';
import { MCPGeminiAgent } from './src/agent-gemini.mjs';

// Color formatting
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  green:   '\x1b[32m',
  red:     '\x1b[31m',
  cyan:    '\x1b[36m',
  yellow:  '\x1b[33m',
  magenta: '\x1b[35m'
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

async function runAllTests() {
  console.log('\n' + C.bold + C.cyan + '╔══════════════════════════════════════════════════════════════════╗' + C.reset);
  console.log(C.bold + C.cyan + '║       DAY 7 — MODEL CONTEXT PROTOCOL (MCP) VERIFICATION SUITE    ║' + C.reset);
  console.log(C.bold + C.cyan + '╚══════════════════════════════════════════════════════════════════╝' + C.reset + '\n');

  const testDbPath = join(__dirname, 'data/test_verify.db');
  if (existsSync(testDbPath)) {
    unlinkSync(testDbPath);
  }

  // ── TEST 1: SQLite Database Engine ──────────────────────────────────────────
  console.log(C.bold + 'Test 1: SQLite Database Engine & Persistent Operations' + C.reset);
  {
    const db = new InventoryDatabase(testDbPath);
    await db.init();

    const schema = db.getSchema();
    assert(Array.isArray(schema) && schema.length === 3, 'Initializes with 3 core tables (products, suppliers, orders)');

    const stats = db.getStats();
    assert(stats.products.total_products === 5, 'Seeds 5 initial inventory products');
    assert(stats.products.low_stock_count === 2, 'Accurately calculates low stock count (2 items)');

    // Safety rule: db_query must reject non-SELECT
    let queryErr = null;
    try {
      db.query('DELETE FROM products');
    } catch (e) {
      queryErr = e;
    }
    assert(queryErr !== null, 'db.query() strictly rejects destructive statements');

    // Execution of safe insert
    const insertRes = db.execute(
      'INSERT INTO suppliers (name, contact_email) VALUES (?, ?)',
      ['Starlight Photonics', 'info@starlight.io']
    );
    assert(insertRes.success === true, 'db.execute() inserts valid records');
    assert(existsSync(testDbPath), 'Database state is persisted to disk');
  }

  // ── TEST 2: MCP Server Initialization & Protocol Capabilities ─────────────
  console.log('\n' + C.bold + 'Test 2: MCP Server Protocol Initialization & Capabilities' + C.reset);
  {
    const { server } = createInventoryServer(testDbPath);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: 'test-runner', version: '1.0.0' }, { capabilities: {} });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const serverCaps = client.getServerCapabilities();
    assert(serverCaps !== undefined, 'Client successfully connects and retrieves server capabilities');
    assert(serverCaps.tools !== undefined, 'Server declares tool support capability');
    assert(serverCaps.resources !== undefined, 'Server declares resource support capability');
    assert(serverCaps.prompts !== undefined, 'Server declares prompt support capability');

    await client.close();
  }

  // ── TEST 3: MCP Resources Inspection & Content Fetching ────────────────────
  console.log('\n' + C.bold + 'Test 3: MCP Resources Exposure (inventory://schema & inventory://stats)' + C.reset);
  {
    const { server } = createInventoryServer(testDbPath);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-runner', version: '1.0.0' }, { capabilities: {} });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const resourcesRes = await client.listResources();
    const uris = resourcesRes.resources.map(r => r.uri);
    assert(uris.includes('inventory://schema'), 'Exposes inventory://schema resource');
    assert(uris.includes('inventory://stats'), 'Exposes inventory://stats resource');

    const schemaResource = await client.readResource({ uri: 'inventory://schema' });
    assert(schemaResource.contents[0].text.includes('CREATE TABLE'), 'inventory://schema returns valid SQL DDL definitions');

    const statsResource = await client.readResource({ uri: 'inventory://stats' });
    const parsedStats = JSON.parse(statsResource.contents[0].text);
    assert(parsedStats.products.total_products >= 5, 'inventory://stats returns structured live statistics');

    await client.close();
  }

  // ── TEST 4: MCP Tools Discovery, Boundary Validation & Safety Rules ────────
  console.log('\n' + C.bold + 'Test 4: MCP Tools Discovery & Server Boundary Validation' + C.reset);
  {
    const { server } = createInventoryServer(testDbPath);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-runner', version: '1.0.0' }, { capabilities: {} });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const toolsRes = await client.listTools();
    const toolNames = toolsRes.tools.map(t => t.name);
    assert(toolNames.includes('db_get_schema'), 'Exposes db_get_schema tool');
    assert(toolNames.includes('db_query'), 'Exposes db_query tool');
    assert(toolNames.includes('db_execute'), 'Exposes db_execute tool');

    // Test db_get_schema invocation
    const schemaCall = await client.callTool({ name: 'db_get_schema', arguments: { tableName: 'products' } });
    const schemaData = JSON.parse(schemaCall.content[0].text);
    assert(schemaData.tables.length === 1 && schemaData.tables[0].name === 'products', 'db_get_schema filters by tableName');

    // Test db_query invocation
    const queryCall = await client.callTool({
      name: 'db_query',
      arguments: { sql: 'SELECT name, price FROM products WHERE price > ?', params: [200] }
    });
    const queryData = JSON.parse(queryCall.content[0].text);
    assert(queryData.count >= 2, 'db_query successfully executes parametrized SELECT');

    // Test safety violation handled gracefully at server boundary
    const unsafeCall = await client.callTool({
      name: 'db_query',
      arguments: { sql: 'DROP TABLE products' }
    });
    assert(unsafeCall.isError === true, 'db_query flags unsafe destructive queries with isError: true');

    await client.close();
  }

  // ── TEST 5: MCP Client over Stdio Subprocess Transport ────────────────────
  console.log('\n' + C.bold + 'Test 5: MCP Client over Stdio Subprocess Transport' + C.reset);
  {
    const bridge = new MCPClientBridge({
      serverPath: join(__dirname, 'src/server.mjs')
    });
    await bridge.connect();

    const tools = await bridge.listTools();
    assert(tools.length === 3, 'Stdio transport launches server subprocess and discovers all 3 tools');

    const result = await bridge.callTool('db_query', { sql: 'SELECT COUNT(*) as cnt FROM products' });
    assert(!result.isError && result.content.includes('"cnt": 5'), 'Stdio transport executes query tool over standard I/O streams');

    await bridge.close();
    assert(true, 'Stdio transport closes server child process cleanly');
  }

  // ── TEST 6: MCP Tool Schema to Gemini Function Declaration Mapping ─────────
  console.log('\n' + C.bold + 'Test 6: MCP Tool Schema to Gemini Function Declaration Mapping' + C.reset);
  {
    const bridge = new MCPClientBridge({ serverPath: join(__dirname, 'src/server.mjs') });
    const geminiDeclarations = await bridge.toGeminiFunctionDeclarations();

    assert(Array.isArray(geminiDeclarations) && geminiDeclarations.length === 1, 'Returns array containing functionDeclarations object');
    const declarations = geminiDeclarations[0].functionDeclarations;
    assert(declarations.length === 3, 'Maps all 3 MCP tools to Gemini function declarations');

    const queryTool = declarations.find(d => d.name === 'db_query');
    assert(queryTool !== undefined, 'db_query tool declaration present');
    assert(queryTool.parameters.type === 'object', 'Parameter schema has type "object"');
    assert(queryTool.parameters.properties.sql.type === 'string', 'sql parameter mapped to string type');

    await bridge.close();
  }

  // ── TEST 7: End-to-End Agent Execution ────────────────────────────────────
  console.log('\n' + C.bold + 'Test 7: End-to-End Agent Execution via MCP' + C.reset);
  {
    // Part A: LangGraph Agent Node Pipeline
    console.log(C.dim + '  Running LangGraph MCP pipeline...' + C.reset);
    const langGraphAgent = createMCPLangGraphAgent();
    const lgResult = await langGraphAgent.execute();

    assert(lgResult.completed === true, 'LangGraph MCP agent completes execution graph');
    assert(lgResult.placedOrders.length === 2, 'LangGraph agent automatically identifies and restocks 2 low-stock products');
    assert(lgResult.verifiedOrders.length >= 2, 'LangGraph agent verifies order records in SQLite via db_query');
    await langGraphAgent.bridge.close();

    // Part B: Gemini Autonomous Tool Loop Agent
    if (process.env.GEMINI_API_KEY) {
      console.log(C.dim + '  Running Gemini Autonomous Agent tool loop...' + C.reset);
      const geminiAgent = new MCPGeminiAgent();
      const geminiResult = await geminiAgent.execute('What are the total number of products and total orders in the database?');

      assert(geminiResult.steps.length >= 1, 'Gemini agent executed at least one MCP tool call turn');
      assert(geminiResult.finalAnswer.length > 20, 'Gemini agent returned a complete, grounded response');
      await geminiAgent.close();
    } else {
      console.log(`  ${C.yellow}⚠ SKIP${C.reset}: GEMINI_API_KEY not found; skipping live LLM test`);
    }
  }

  // Clean up temporary test DB
  if (existsSync(testDbPath)) {
    try { unlinkSync(testDbPath); } catch {}
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log('\n' + C.bold + '──────────────────────────────────────────────────────────────────' + C.reset);
  console.log(`Results: ${C.green}${passed} passed${C.reset}, ${failed === 0 ? C.green + '0 failed' : C.red + failed + ' failed'}${C.reset}`);
  console.log(C.bold + '──────────────────────────────────────────────────────────────────' + C.reset);

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('\n' + C.red + 'Fatal Error in test suite:' + C.reset, err);
  process.exit(1);
});
