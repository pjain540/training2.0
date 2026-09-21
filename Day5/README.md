# Day 5 — LangChain Framework: LCEL RAG & Tool-Calling Agent

A complete, production-grade rebuild of our Day 2 (ReAct Agent) and Day 3 (RAG Pipeline) implementations using modern **LangChain** (`@langchain/core`, `@langchain/google-genai`, `@langchain/textsplitters`) and **LangGraph** (`@langchain/langgraph`).

---

## 📑 Overview

In Days 1 through 4, we built foundational LLM concepts, autonomous agents, RAG pipelines, and multi-agent supervisory systems completely from scratch using the raw `@google/genai` SDK.

On **Day 5**, we evaluate how enterprise industry-standard frameworks solve these identical challenges:
1. **LangChain Expression Language (LCEL)** for declarative RAG pipelines (`retriever | prompt | model | parser`).
2. **LangChain Embeddings Adapter** bridging Gemini's `embedContent` API into LangChain vector stores.
3. **LangGraph Prebuilt ReAct Agent** with declarative Zod-validated tools (`knowledge_base_search` and `calculator`).
4. **MemoryVectorStore & Recursive Splitters** replacing hundreds of lines of custom mathematical code.
5. **Architectural Trade-Off Analysis** measuring line-count reductions against framework overhead, abstraction leakage, and debugging complexity.

---

## 📁 Repository Structure

```
Day5/
├── .env.example              # Template for API keys
├── .gitignore                # Strict repo hygiene (ignores node_modules, .env, *.log)
├── package.json              # ES module configuration & dependencies
├── README.md                 # System overview and quickstart guide
├── COMPARISON.md             # Quantitative & architectural comparison (Day 2/3 vs Day 5)
├── verify-day5.mjs           # Automated verification test suite
├── run-rag.mjs               # Standalone RAG CLI runner
├── run-agent.mjs             # Multi-tool agent CLI runner (with --chat mode)
├── docs/                     # Knowledge base documents
│   ├── architecture_overview.md
│   ├── security_handbook.md
│   └── troubleshooting_guide.txt
└── src/
    ├── embeddings.mjs        # Gemini embeddings adapter for LangChain
    ├── rag-chain.mjs         # LCEL retrieval chain implementation
    ├── agent.mjs             # LangGraph ReAct agent with memory & tracing
    └── tools/
        └── rag-tool.mjs      # Zod-validated tools (RAG search + calculator)
```

---

## 🚀 Quickstart & Setup

### 1. Configure Environment Variables
Copy `.env.example` to `.env` and configure your Google Gemini API key:
```bash
cp .env.example .env
```
Ensure your `.env` contains:
```ini
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
```

### 2. Install Dependencies
```bash
npm install
```

---

## 🏃 Running the Applications

### 1. Query the RAG Pipeline Directly
Query the LCEL RAG pipeline with grounded citations:
```bash
npm run rag "What is the replication topology in NebulaCloud?"
```
Or with custom questions:
```bash
node run-rag.mjs "What HTTP status code and error code indicates rate limiting?"
```

### 2. Run the Autonomous ReAct Agent
Run the LangGraph ReAct agent on single-step or multi-step tasks:

```bash
# Query knowledge base via agent
node run-agent.mjs "What security protocols does NebulaCloud enforce?"

# Composite task requiring knowledge retrieval + mathematical calculation
node run-agent.mjs "Look up the SLA uptime in NebulaCloud and calculate how many hours of downtime that allows per year."

# With verbose execution tracing
node run-agent.mjs "What is the recovery protocol for error code E1002?" --verbose
```

### 3. Interactive Chat Mode
Start an interactive conversation session maintaining stateful memory:
```bash
node run-agent.mjs --chat
```

---

## 🧪 Automated Verification Suite

To run all 7 end-to-end verification tests:
```bash
npm test
```
Or directly:
```bash
node verify-day5.mjs
```

### Verification Tests Covered:
- [x] **Declarative Calculator Tool**: Floating point math and syntax safety.
- [x] **Document Ingestion & Indexing**: Document parsing and `MemoryVectorStore` generation.
- [x] **LCEL RAG Pipeline & Grounding**: Retrieval accuracy and source attribution.
- [x] **Out-of-Domain Guardrails**: Strict fallback behavior preventing hallucinations.
- [x] **ReAct Agent Tool Calling**: Agent dynamic invocation of `knowledge_base_search`.
- [x] **Composite Multi-Step Task**: Multi-tool coordination (RAG lookup + calculation).
- [x] **Multi-Turn Memory Persistence**: In-memory message tracking across conversational turns.

---

## 📊 Summary Comparison

| Dimension | Hand-Rolled (Days 2 & 3) | LangChain & LangGraph (Day 5) |
| :--- | :--- | :--- |
| **Core Lines of Code** | 1,410 lines | 230 lines (-83.7%) |
| **Tool Calling Mechanism** | Regex parsing of text (`Thought/Action/Input`) | Native Gemini function calling schemas via Zod |
| **Chain Composition** | Procedural `async/await` step execution | Declarative LCEL (`retriever \| prompt \| llm \| parser`) |
| **Debugging Complexity** | Low — explicit stack traces, zero indirection | High — deep framework stack traces, hidden abstractions |
| **Ecosystem Portability** | Manual implementation per vector store / tool | Swappable retrievers, memory stores, and model providers |

For an in-depth breakdown, see [COMPARISON.md](file:///home/poorti/Desktop/training2.0/Day5/COMPARISON.md).
