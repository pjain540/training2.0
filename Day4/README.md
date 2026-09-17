# Day 4 — Multi-Agent Systems & Orchestration

A multi-agent content generation and review system featuring:
- **Central Blackboard Pattern (`PipelineState`)** for state management and audit trails.
- **Supervisor Pattern (`PipelineSupervisor`)** orchestrating 3 role-based specialist agents.
- **Day-3 Grounded RAG Integration (`ResearcherAgent`)** querying pre-computed vector embeddings.
- **Technical Drafting (`WriterAgent`)** with automatic citation enforcement.
- **Strict Evaluator (`CriticAgent`)** returning structured JSON critique with a maximum 1-revision cycle.
- **Human-In-The-Loop Gate (`HumanInTheLoopGate`)** providing terminal approval, editing, or rejection before disk persistence.

---

## Architecture Diagram

```
                              [ User Topic ]
                                    │
                                    ▼
                     ┌──────────────────────────────┐
                     │     PipelineSupervisor       │
                     └──────────────┬───────────────┘
                                    │ (Initializes State)
                                    ▼
                     ┌──────────────────────────────┐
                     │       ResearcherAgent        │
                     │  (Queries Day-3 Vector Store)│
                     └──────────────┬───────────────┘
                                    │ (Facts & Citations)
                                    ▼
                     ┌──────────────────────────────┐
                     │         WriterAgent          │◄───────────┐
                     │    (Synthesizes Draft)       │            │
                     └──────────────┬───────────────┘            │
                                    │ (Draft Content)            │ (Max 1 Revision)
                                    ▼                            │
                     ┌──────────────────────────────┐            │
                     │         CriticAgent          │            │
                     │ (JSON Audit: Score & Verdict)├────────────┘
                     └──────────────┬───────────────┘ (status: "REVISE" & iter < 1)
                                    │
                                    │ (status: "APPROVED" or max iterations reached)
                                    ▼
                     ┌──────────────────────────────┐
                     │   HumanInTheLoopGate (HITL)  │
                     └──────────────┬───────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         ▼                          ▼                          ▼
   [ [A] Approve ]           [ [E] Edit ]               [ [R] Reject ]
   Saves to output/          Appends notes & saves      Aborts without saving
```

---

## Quick Start

### 1. Install Dependencies
```bash
cd Day4
npm install
```

### 2. Run Automated Verification Suite
```bash
npm test
# Or: node verify-day4.mjs
```

### 3. Run the Interactive Multi-Agent CLI
```bash
npm start
# Or with a custom topic:
node run-pipeline.mjs "What is the availability SLA and consensus model for NebulaCloud?"
```

---

## Project Structure

```text
Day4/
├── .env                  # API configuration (GEMINI_API_KEY)
├── .env.example          # Environment template
├── package.json          # Module definition & scripts
├── run-pipeline.mjs      # Interactive CLI entry point
├── verify-day4.mjs       # Automated end-to-end test suite
├── README.md             # Documentation
└── src/
    ├── state.mjs         # Centralized PipelineState model
    ├── supervisor.mjs    # Finite-state orchestrator
    ├── hitl.mjs          # Human-in-the-loop checkpoint gate
    └── agents/
        ├── researcher.mjs # RAG retrieval specialist
        ├── writer.mjs     # Markdown authoring specialist
        └── critic.mjs     # Rigorous editorial evaluator
```

---

## Interview Hour Study Guide

### 1. Orchestration Patterns
- **Sequential**: Best when steps have strict upstream dependencies (ETL, research $\to$ draft $\to$ review).
- **Parallel**: Best for independent subtasks (gathering from 5 APIs at once, then aggregating).
- **Supervisor/Router**: Dynamic coordinator evaluating step outcomes and routing execution dynamically with loop limits.

### 2. When Does a Single Agent Beat Multi-Agent?
- Tasks requiring $<5$ tools without conflicting prompts or personas.
- Latency-sensitive and cost-sensitive applications (multi-agent multiplies roundtrips).
- Use Multi-Agent when personas must conflict (e.g. creative Writer vs. strict Critic) or context window hygiene is essential.

### 3. State Passing Mechanisms
- **Central Blackboard (State)**: Agents inspect and mutate a shared context object. Clean auditability, easy checkpointing, and replay capability.

### 4. Human-In-The-Loop (HITL) Checkpoints
- Required at high-blast-radius actions: committing code, modifying databases, financial operations, or publishing output.
- Allows approval, in-line editorial revision, or outright rejection before disk/DB write.
