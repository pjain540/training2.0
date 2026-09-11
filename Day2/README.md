# Day 2: The Autonomous Agent — Loop, State, Tools & Guardrails

> **Core Objective**: Understand what actually makes something an "agent": the loop, state, tools, and when **NOT** to use one. Build a hand-rolled ReAct-style agent from scratch (no frameworks) around the Gemini API with tool dispatch, working memory, and a visible step-by-step trace.

---

## 📚 Table of Contents
1. [Interview Hour: Core Concepts & Deep Dive](#interview-hour-core-concepts--deep-dive)
   - [LLM vs. Workflow vs. Agent](#1-llm-vs-workflow-vs-agent)
   - [The Agent Loop: Perceive → Decide → Act → Observe](#2-the-agent-loop-perceive--decide--act--observe)
   - [Agent State & Working Memory](#3-agent-state--working-memory)
   - [The Risks of Autonomy & Guardrails](#4-the-risks-of-autonomy--guardrails)
2. [When to Use What: Decision Matrix](#when-to-use-what-decision-matrix)
3. [Architecture & Folder Structure](#architecture--folder-structure)
4. [Modular File Walkthrough](#modular-file-walkthrough)
5. [Quickstart & CLI Usage](#quickstart--cli-usage)
6. [Automated Verification Suite](#automated-verification-suite)

---

## Interview Hour: Core Concepts & Deep Dive

### 1. LLM vs. Workflow vs. Agent

Understanding the fundamental boundaries between pure language models, deterministic workflows, and autonomous agents is critical for architectural decisions.

| Attribute | Pure LLM Call | Deterministic Workflow | Autonomous Agent |
| :--- | :--- | :--- | :--- |
| **Control Flow** | 1-turn Request → Response | Hardcoded Directed Acyclic Graph (DAG) | Dynamic, self-directed loop |
| **Tool Execution** | None (Static knowledge) | Pre-programmed sequential calls | Dynamic decision of which tool and when |
| **Stop Condition** | Output token generation finishes | Pipeline steps finish | Agent decides goal is met or cap reached |
| **Latency & Cost** | Low & predictable | Predictable | Variable (scales with turns and tool calls) |
| **Reliability** | Medium (hallucination risk) | High (deterministic code controls flow) | Medium-High (requires guardrails) |
| **Example** | "Summarize this 500-word email." | Fetch user profile → Summarize order history → Send template email. | "Investigate why customer churn spiked 8% in Q2 and prepare a slide summary." |

#### Detailed Definitions:
- **LLM Call**: A stateless text-in, text-out query. The model cannot inspect new data, browse live systems, or take actions in the external world.
- **Workflow (Prompt Chain / DAG)**: Traditional software with LLMs embedded as steps. Step A runs, its output goes to Step B, then Step C. The sequence of steps is **hardcoded by the engineer**.
- **Autonomous Agent**: The model itself decides **what to do next**. It inspects a goal, chooses an action, observes the result, and loops until it decides the task is complete.

---

### 2. The Agent Loop: Perceive → Decide → Act → Observe

An agent is fundamentally a state machine running in a loop:

```
                  ┌────────────────────────┐
                  │       USER GOAL        │
                  └───────────┬────────────┘
                              │
                              ▼
        ┌──────────────────────────────────────────────┐
   ┌───►│ 1. PERCEIVE                                  │
   │    │ Read user goal, scratchpad & tool history    │
   │    └─────────────────────┬────────────────────────┘
   │                          ▼
   │    ┌──────────────────────────────────────────────┐
   │    │ 2. DECIDE                                    │
   │    │ Reason: Need more data or have final answer? │
   │    └──────────────┬───────────────────────────────┘
   │                   │
   │         Tool Call │            ┌───────────────────┐
   │         Requested │            │ STOP CONDITION:   │
   │                   ├───────────►│ No tools needed   │
   │                   ▼            │ → Final Answer!   │
   │    ┌─────────────────────────┐ └───────────────────┘
   │    │ 3. ACT (Tool Dispatch)  │
   │    │ Code executes tool func │
   │    └──────────────┬──────────┘
   │                   ▼
   │    ┌─────────────────────────┐
   │    │ 4. OBSERVE              │
   │    │ Feed tool result back   │
   │    │ into agent scratchpad   │
   │    └──────────────┬──────────┘
   │                   │
   └───────────────────┘
```

1. **Perceive**: The model receives the current conversation history, system prompt, and any observations from previous tool runs.
2. **Decide**: The model determines the next best step. It either selects a specific tool with arguments (e.g. `search_web`, `calculator`) or determines that it has enough information to form the final response.
3. **Act**: Host code intercepts the tool request, executes the corresponding JavaScript function (safe sandboxing, API calls, database lookups), and captures the output.
4. **Observe**: The execution result is fed back into the model as a `functionResponse` message. The loop cycles back to **Perceive**.

---

### 3. Agent State & Working Memory

Without state, an agent cannot solve multi-step problems. State is maintained across two layers:

1. **Conversation History (Short-term Context Window)**:
   - System prompt (rules & personas).
   - User prompt (initial objective).
   - Assistant turns (tool call proposals).
   - User / Function turns (tool observations).
2. **Working Memory / Scratchpad (`AgentMemory`)**:
   - Structured step records: `{ step, thought, action, observation, durationMs }`.
   - Tool usage metrics (which tools were called and how often).
   - Stop reason tracking (`completed`, `max_iterations_reached`, `api_error`).

---

### 4. The Risks of Autonomy & Guardrails

Giving an LLM control over execution loops introduces critical risks:

| Risk | Impact | Guardrail / Mitigation |
| :--- | :--- | :--- |
| **Infinite Loops** | The model repeatedly calls the same failing tool or gets stuck in a cycle. | **Max-Iteration Cap** (e.g., hard cutoff at 5 or 10 steps). |
| **Cost & Token Explosion** | Each loop re-sends the growing conversation history, multiplying token usage. | Token tracking + Context pruning + Iteration limits. |
| **Hallucinated Tool Calls** | Model calls a tool with invalid names or illegal parameter shapes. | **Tool Registry Validation**: Catch unregistered calls and return clear error messages to the model so it can self-correct. |
| **Unsafe Execution** | Arithmetic tools executing arbitrary code strings via raw `eval()`. | **Strict Whitelisting & Sandboxing**: Strip dangerous identifiers before evaluation. |

---

## When to Use What: Decision Matrix

```
Is the task fixed and predictable?
├── YES ──► Use Deterministic Workflow (Hardcoded pipeline / DAG)
└── NO
    └── Does it require real-time interaction, tool usage, or multi-step discovery?
        ├── NO ──► Use a Single LLM Call (Zero-shot or Few-shot prompt)
        └── YES ──► Use an Autonomous Agent (With strict max-iteration cap & tool registry)
```

---

## Architecture & Folder Structure

Day 2 maintains a clean, single-responsibility modular structure:

```
Day2/
├── .env                          # Local environment variables (GEMINI_API_KEY)
├── .env.example                  # Template environment file
├── package.json                  # Node.js module manifest, scripts & dependencies
├── README.md                     # Comprehensive documentation & theory guide
├── agent.mjs                     # Unified Agent facade (orchestrates tools, memory, loop)
├── run-agent.mjs                 # Interactive CLI runner with visible step traces
├── verify-day2.mjs               # 6-suite automated test verification runner
└── src/
    ├── tools/
    │   ├── calculator.mjs        # Tool 1: Safe math evaluation & percentage parser
    │   ├── search.mjs            # Tool 2: Web / Demographics search stub
    │   └── registry.mjs          # Tool registry, schema generator & safe dispatcher
    ├── memory.mjs                # Scratchpad working memory & step-by-step state
    ├── logger.mjs                # Colored terminal trace visualizer
    └── agent-loop.mjs            # Core ReAct engine (Perceive -> Decide -> Act -> Observe)
```

---

## Modular File Walkthrough

1. **`src/tools/calculator.mjs`**:
   - Declares the Gemini `calculator` tool schema.
   - Normalizes percentages (`15% of X` -> `(15/100) * X`) and exponents (`^` -> `**`).
   - Strict character whitelisting prevents code injection attacks.
2. **`src/tools/search.mjs`**:
   - Declares the `search_web` tool schema.
   - Provides indexed knowledge for country populations (France, Germany, USA, etc.) and scientific constants.
   - Robust whole-word/phrase scoring prevents false positives.
3. **`src/tools/registry.mjs`**:
   - Aggregates tool declarations into the format required by Gemini's API (`tools: [{ functionDeclarations }]`).
   - Dispatches tool executions and isolates errors into `{ error: string }` responses.
4. **`src/memory.mjs`**:
   - Manages the agent's scratchpad working memory.
   - Records each step's timestamp, tool name, inputs, outputs, and latency.
5. **`src/logger.mjs`**:
   - Produces the visible step-by-step trace using distinct ANSI colors.
6. **`src/agent-loop.mjs`**:
   - Orchestrates the multi-turn `ai.chats` interaction.
   - Enforces the `maxIterations` guardrail cutoff.
   - Detects the stop condition when the model finishes without requesting tools.
7. **`agent.mjs`**:
   - The unified facade matching Day 1 conventions for creating and running agents.

---

## Quickstart & CLI Usage

### 1. Run the Multi-Step Challenge
Solve "What is 15% of the population of France?":
```bash
node run-agent.mjs "What is 15% of the population of France?"
```

### 2. Guardrail Demonstration (Max-Iteration Cutoff)
Demonstrate the infinite loop guardrail by capping iterations to 1:
```bash
node run-agent.mjs "What is 15% of the population of France?" --max-iterations 1
```

### 3. Full JSON Execution Trace
Export structured machine-readable logs of all agent steps:
```bash
node run-agent.mjs "What is 15% of the population of France?" --json
```

---

## Automated Verification Suite

Run the 6 verification suites:
```bash
npm test
# or: node verify-day2.mjs
```

### Verification Matrix:
1. **Calculator Tool**: Evaluates arithmetic, percentages, and handles division-by-zero & injection attempts.
2. **Search Tool Stub**: Resolves demographics for France and provides graceful fallbacks for unknown queries.
3. **Tool Registry & Dispatcher**: Validates Gemini schemas, dispatches calls, and wraps execution errors.
4. **Working Memory & Scratchpad**: Verifies step-by-step state recording and session summary generation.
5. **End-to-End ReAct Agent Loop**: Confirms multi-step goal resolution (`search_web` → `calculator` → Final Answer).
6. **Guardrail Max-Iteration Cap**: Confirms clean safety cutoff when iteration cap is hit.
