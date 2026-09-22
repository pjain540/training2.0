# Day 7 — Model Context Protocol (MCP) Server & Agent System

A complete implementation of a custom **Model Context Protocol (MCP)** server over a real SQLite database system, paired with an MCP client and two agent runtimes (Autonomous Gemini Agent & LangGraph Multi-Node Pipeline).

---

## System Architecture

```
                               ┌────────────────────────────────────────┐
                               │             MCP HOST AGENT             │
                               │                                        │
                               │  ┌──────────────────────────────────┐  │
                               │  │       Gemini / LangGraph         │  │
                               │  └──────────────────▲───────────────┘  │
                               │                     │                  │
                               │  ┌──────────────────▼───────────────┐  │
                               │  │         MCPClientBridge          │  │
                               │  │   (Stdio / InMemory Transport)   │  │
                               │  └──────────────────▲───────────────┘  │
                               └─────────────────────┼──────────────────┘
                                                     │ JSON-RPC 2.0 (stdio)
                                                     ▼
┌───────────────────────────────────────────────────────────────────────┐
│                      CUSTOM MCP SERVER (server.mjs)                   │
│                                                                       │
│   ┌───────────────────────┐ ┌──────────────────────┐ ┌─────────────┐  │
│   │         TOOLS         │ │      RESOURCES       │ │   PROMPTS   │  │
│   ├───────────────────────┤ ├──────────────────────┤ ├─────────────┤  │
│   │ • db_get_schema       │ │ • inventory://schema │ │ • inventory │  │
│   │ • db_query (SELECT)   │ │ • inventory://stats  │ │   _audit    │  │
│   │ • db_execute (DML)    │ │                      │ │             │  │
│   └───────────▲───────────┘ └──────────▲───────────┘ └──────▲──────┘  │
│               │                        │                    │         │
│               └────────────────────────┼────────────────────┘         │
│                                        ▼                              │
│                      ┌───────────────────────────────────┐            │
│                      │      InventoryDatabase (db.mjs)   │            │
│                      │      (SQLite / WebAssembly)       │            │
│                      └─────────────────▲─────────────────┘            │
└────────────────────────────────────────┼──────────────────────────────┘
                                         ▼
                               ┌───────────────────┐
                               │ data/inventory.db │
                               └───────────────────┘
```

---

## Features

1. **Custom MCP Server (`src/server.mjs`)**:
   - Implemented using `@modelcontextprotocol/sdk`.
   - **Tools**:
     - `db_get_schema`: Dynamic database reflection and table DDL inspection.
     - `db_query`: Read-only SELECT query execution with parameter binding and query safety validation.
     - `db_execute`: State mutation (INSERT, UPDATE, DELETE) with execution audit and persistence.
   - **Resources**:
     - `inventory://schema`: Real-time SQL DDL definitions for system tables.
     - `inventory://stats`: Live aggregate database metrics (total products, low stock count, suppliers, orders).
   - **Prompts**:
     - `inventory_audit`: Parametrized stock audit template.
   - Runs as standalone CLI service communicating over standard I/O (Stdio JSON-RPC).

2. **MCP Client Bridge (`src/mcp-client.mjs`)**:
   - Connects to MCP servers via `StdioClientTransport` subprocess or `InMemoryTransport`.
   - Discovers tools, resources, and server capabilities dynamically.
   - Bridges MCP tool JSON Schemas directly to Gemini `functionDeclarations` (fulfilling Day 1 tool-calling model mapping).

3. **Autonomous Gemini Agent (`src/agent-gemini.mjs`)**:
   - Executes multi-turn tool calling loops against the MCP server.
   - Diagnoses inventory shortages, queries suppliers, and records purchase orders autonomously.

4. **MCP LangGraph Multi-Node Pipeline (`src/agent-langgraph.mjs`)**:
   - Wires MCP tools & resources into a Day 6 `StateGraph` workflow:
     - `[inspector]` -> Reads `inventory://stats` MCP resource.
     - `[auditor]` -> Executes `db_query` MCP tool to find depleted items.
     - `[restocker]` -> Executes `db_execute` MCP tool to create purchase orders.
     - `[verifier]` -> Executes `db_query` MCP tool to confirm persistence.

---

## Quickstart

### 1. Run Verification Suite (All 33 Tests)
```bash
npm test
```

### 2. Run Autonomous Gemini MCP Agent
```bash
npm start
# Or with a custom objective:
node src/run-agent.mjs "Find all suppliers for the Compute category and check their products."
```

### 3. Run LangGraph MCP Pipeline
```bash
node src/run-agent.mjs --langgraph
```

### 4. Run MCP Server Standalone
```bash
node src/server.mjs
```

---

## File Structure

```
Day7/
├── data/
│   └── inventory.db          # Persistent SQLite database file
├── src/
│   ├── db.mjs                # SQLite WebAssembly engine & schema definitions
│   ├── server.mjs            # Custom MCP Server (tools, resources, prompts)
│   ├── mcp-client.mjs        # MCP Client bridge and schema translator
│   ├── agent-gemini.mjs      # Autonomous multi-turn Gemini agent over MCP
│   ├── agent-langgraph.mjs   # LangGraph StateGraph pipeline over MCP
│   └── run-agent.mjs         # CLI runner interface
├── package.json              # Dependencies & npm scripts
├── verify-day7.mjs           # 7-suite comprehensive automated test suite
├── INTERVIEW_PREP.md         # MCP architecture, comparisons & security guide
└── README.md                 # System documentation
```
