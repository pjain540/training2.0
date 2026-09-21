# Day 6 — LangGraph Multi-Agent Architecture with Checkpointed HITL Gate

This project implements the Day 4 multi-agent pipeline using **LangGraph** (`@langchain/langgraph`), featuring explicit graph nodes, state annotation schema, conditional revision loops, and native checkpointed human-in-the-loop interrupts.

---

## Architecture Overview

```
 [START]
    ↓
[researcher] ── (Grounds facts from Day 3 vector store or fallback)
    ↓
  [writer] ◄──────────────┐ (Revision cycle)
    ↓                     │
  [critic] ───────────────┘ (Conditional edge: status == 'REVISE' && iteration < max)
    ↓ (status == 'APPROVED' or iteration >= max)
[humanApproval] ── (Checkpointed interrupt: APPROVED / EDITED / REJECTED)
    ↓
  [END]
```

### Key Components

1. **State Annotation Schema (`src/state.mjs`)**:
   Defines typed blackboard schema using LangGraph `Annotation.Root`:
   - `topic`, `facts`, `citations`, `draft`, `draftHistory`
   - `critiqueHistory`, `iteration`, `maxIterations`
   - `status`, `humanDecision`, `logs` (with append reducer)

2. **Nodes (`src/nodes/`)**:
   - `researcher.mjs`: Retrieves grounded chunks from Day 3 knowledge base.
   - `writer.mjs`: Produces initial drafts and addresses Critic feedback in revisions.
   - `critic.mjs`: Audits drafts for citations and quality, returning structured evaluation.
   - `human.mjs`: Checkpoint interrupt node using `interrupt()` for human approval.

3. **Graph Assembly (`src/graph.mjs`)**:
   - `StateGraph` configuration with `MemorySaver` checkpointer.
   - Conditional routing via `routeAfterCritic(state)`.

4. **CLI & Verification (`run-graph.mjs`, `verify-day6.mjs`)**:
   - Interactive CLI runner with live streaming and state resumption.
   - Comprehensive test suite covering state defaults, routing, interrupts, and live Gemini runs.

---

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Ensure `.env` contains your Gemini API key:
```bash
cp .env.example .env
# Set GEMINI_API_KEY
```

### 3. Run Verification Tests
```bash
npm test
```

### 4. Run the Pipeline
```bash
# Interactive run with CLI prompts:
npm start

# Custom topic:
node run-graph.mjs "What is the consensus model and SLA in NebulaCloud?"

# Auto-approve:
node run-graph.mjs --auto-approve

# Reject:
node run-graph.mjs --reject
```

---

## Architectural Comparison
For a detailed analysis comparing Day 4 (handcrafted state machine), Day 5 (LangChain LCEL), and Day 6 (LangGraph), see [`COMPARISON.md`](./COMPARISON.md).
