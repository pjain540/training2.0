# Day 7 — Model Context Protocol (MCP) Interview Preparation

This document breaks down the fundamental concepts, architectural paradigms, practical trade-offs, and security considerations of the **Model Context Protocol (MCP)**.

---

## 1. What MCP is and the Problem it Solves

### The $N \times M$ Problem
Before MCP, connecting $N$ different LLM applications/agents to $M$ external tools, databases, or SaaS systems required writing custom, bespoke integration logic for every combination:
- OpenAI used `tools` / `functions` with specific JSON Schema format.
- Anthropic Claude used `tools` with `input_schema`.
- Google Gemini used `functionDeclarations` with `parameters`.
- Every developer rewrote authentication, database connection pools, filesystem access, and API drivers inside every single agent or client application.

### The MCP Solution
**Model Context Protocol (MCP)** is an open protocol created by Anthropic that standardizes how applications provide context and tools to LLMs. It operates like **USB-C or Language Server Protocol (LSP)** for AI:
- Tool and data providers build **one MCP Server** (e.g. SQLite, GitHub, Slack, Postgres).
- Any **MCP Host/Client** (Claude Desktop, Antigravity IDE, LangGraph, custom agents) can plug into that server using standard JSON-RPC without custom code.

---

## 2. Client–Server Architecture

MCP follows a client-server architecture with three primary actors:

```
┌──────────────────────────────────────────────────────────┐
│                        MCP HOST                          │
│  (e.g., Antigravity IDE, Claude Desktop, Agent Runtime)   │
│                                                          │
│   ┌────────────────────┐         ┌────────────────────┐  │
│   │    LLM / Agent     │         │     MCP Client     │  │
│   └─────────▲──────────┘         └─────────▲──────────┘  │
└─────────────┼──────────────────────────────┼─────────────┘
              │                              │ JSON-RPC 2.0
              │                              ▼ (stdio / SSE)
┌─────────────┴────────────────────────────────────────────┐
│                       MCP SERVER                         │
│   (e.g., sqlite-inventory-mcp, postgres-mcp, github-mcp) │
│                                                          │
│   ┌───────────────┐   ┌───────────────┐  ┌───────────┐   │
│   │     Tools     │   │   Resources   │  │  Prompts  │   │
│   │ (db_execute)  │   │(inventory://) │  │  (audit)  │   │
│   └───────▲───────┘   └───────▲───────┘  └─────▲─────┘   │
│           │                   │                │         │
│           └───────────────────┼────────────────┘         │
│                               ▼                          │
│                 Underlying System / Database             │
└──────────────────────────────────────────────────────────┘
```

### Key Components:
1. **Host**: The container application (IDE, CLI, workflow coordinator) orchestrating agents, UI, and security permissions.
2. **Client**: A protocol client within the host maintaining a 1:1 connection with an MCP server, managing lifecycle, discovery, and message routing.
3. **Server**: A lightweight, standalone process exposing capabilities (tools, resources, prompts) over a standard transport.
4. **Transport**:
   - **Stdio**: Standard input/output streams (`stdin`/`stdout`). Ideal for local tools, CLI utilities, and secure process sandboxing.
   - **SSE (Server-Sent Events) / HTTP**: For remote servers, cloud infrastructure, or multi-tenant microservices.

---

## 3. Tools vs. Resources vs. Prompts

MCP defines three distinct primitives:

| Primitive | Nature | Direction / Control | Analogy | Example in Day 7 |
| :--- | :--- | :--- | :--- | :--- |
| **Tools** | Executable actions with side effects or dynamic queries | Model-controlled: The LLM chooses when and how to call them | Functions / API Endpoints | `db_query`, `db_execute`, `db_get_schema` |
| **Resources** | Static or dynamic context data (read-only) | Client/Host-controlled: Ingested as context documents into prompt | Files / GET Endpoints | `inventory://schema`, `inventory://stats` |
| **Prompts** | Reusable prompt templates & workflows | User/Host-controlled: Predefined conversational structures | Slash commands / Prompt macros | `inventory_audit` |

### Key Differences:
- **Tools** require model decision-making and parameters, execute arbitrary logic, and may modify system state (e.g. database `INSERT`).
- **Resources** are passive, deterministic data streams with a URI scheme (e.g., `git://`, `db://`, `file://`), designed to be fetched and fed into the context window without model invocation.
- **Prompts** empower users or orchestrators to trigger structured interaction workflows with predefined instructions and arguments.

---

## 4. How MCP Differs from Ad-Hoc Function Calling

| Feature | Ad-Hoc Function Calling (Day 1) | Model Context Protocol (MCP) (Day 7) |
| :--- | :--- | :--- |
| **Coupling** | Tightly coupled to specific model provider SDK (`@google/genai`, `openai`) | Decoupled; provider-agnostic standard (JSON-RPC 2.0) |
| **Tool Location** | Inlined inside the application code | Standalone server process running locally or remotely |
| **Reusability** | Must rewrite tool declarations and bindings for each agent | Build once, use across Claude, Cursor, LangGraph, Gemini, etc. |
| **Discovery** | Hardcoded tool lists passed in every prompt | Dynamic discovery via `client.listTools()`, `client.listResources()` |
| **Separation of Concerns** | Application handles both business logic and system drivers | Server handles DB connection/auth; Agent handles reasoning |
| **Composability** | Hard to combine tools from multiple sources | Agent can connect to 10 independent MCP servers simultaneously |

---

## 5. Security Considerations

Exposing real systems (such as SQLite, shell commands, or enterprise APIs) to autonomous LLMs introduces distinct threat surfaces:

1. **Boundary Validation & Sanitization**:
   - Never trust arguments passed by LLMs.
   - Use schema validation (e.g., **Zod**) at the server boundary.
   - Guard against SQL injection via parameterized queries (`?` placeholders), never raw string concatenation.

2. **Least Privilege & Read/Write Separation**:
   - Separate tools by privilege tier: e.g., `db_query` (strictly read-only `SELECT`) vs. `db_execute` (state modifications).
   - Hardcode policy checks to reject destructive operations (e.g., `DROP TABLE`, `TRUNCATE`).

3. **Process Sandboxing (Stdio Transport)**:
   - Stdio communication isolates the server in its own OS process.
   - The server only has access to the permissions of its child process, not the host agent's internal memory.

4. **Human-in-the-Loop (HITL) for High-Impact Actions**:
   - For irreversible actions (e.g., purchasing orders above \$1,000 or dropping data), the MCP client or host can trigger an approval checkpoint before forwarding the call to the server.

5. **Prompt Injection & Indirect Injection**:
   - Untrusted data retrieved via `db_query` or resources could contain malicious instructions designed to hijack the agent ("ignore previous instructions...").
   - Mitigate by quoting context, separating data from instructions, and validating tool outputs before reasoning.
