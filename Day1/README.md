# Day 1: Gemini Node.js Client & `ask-gemini` CLI

A robust, production-grade Gemini client wrapper and CLI tool built in Node.js featuring real-time token streaming, schema-enforced structured JSON output, function calling (tool execution), token usage logging, and resilient exponential backoff retry.

---

## 1. Quick Start

### Prerequisites
- Node.js `v18+` or `v20+`
- Valid Gemini API Key

### Installation
```bash
# Navigate to project directory (or use symlink day1)
cd Day1

# Install dependencies (@google/genai, dotenv)
npm install

# Check environment configuration
# A .env file is provided with your key, or set it manually:
export GEMINI_API_KEY="your-api-key-here"
```

### Make CLI executable
```bash
chmod +x ask-gemini.mjs
```

---

## 2. CLI Flags & Options

| Flag | Short | Type | Default | Description |
| :--- | :---: | :---: | :---: | :--- |
| `--prompt` | `-p` | `string` | *None* | Prompt text (can also be passed as positional arguments). |
| `--json` | | `boolean` | `false` | Enforce schema-validated structured JSON output via `responseSchema`. |
| `--tool` | | `boolean` | `false` | Enables tool/function calling mode (`getCurrentWeather` live mock). |
| `--model` | | `string` | `gemini-3.5-flash-lite` | Gemini model name. |
| `--temperature` | | `float` | `0.7` | Sampling temperature (`0.0` for deterministic, `1.0+` for creative). |
| `--system` | `-s` | `string` | *None* | System instruction to set persona or constraints. |
| `--help` | `-h` | `boolean` | `false` | Displays usage guide and examples. |

---

## 3. Modular Architecture & Project Structure

The codebase is organized into single-responsibility modules inside `src/`:

```text
Day1/
├── ask-gemini.mjs         # CLI entry point (argument parsing, terminal UI)
├── gemini-client.mjs      # Unified facade re-exporting all capabilities
├── verify-day1.mjs        # Automated test suite (npm test)
├── package.json           # ESM configuration & dependencies
├── .env                   # API Key configuration
├── .gitignore             # Excludes .env & node_modules
└── src/
    ├── retry.mjs          # Exponential backoff, jitter, and RetryInfo handler
    ├── tokens.mjs         # Token counting & usage metadata formatting
    ├── streaming.mjs      # Async generator for real-time token streaming
    ├── json-mode.mjs      # Schema definition & structured JSON generator
    └── tool-calling.mjs   # Function declaration, handler, & multi-turn loop
```

### Module Responsibilities

1. **[`src/retry.mjs`](file:///home/poorti/Desktop/training2.0/Day1/src/retry.mjs)**
   Provides `withRetry()` and `isTransientError()`. Automatically catches 429, 500, 502, 503, and network timeouts. Inspects server `RetryInfo` headers (e.g. "retry in 15s") and uses full randomized jitter to avoid thundering herd.

2. **[`src/tokens.mjs`](file:///home/poorti/Desktop/training2.0/Day1/src/tokens.mjs)**
   Provides `countInputTokens()` (estimates prompt tokens beforehand) and `formatUsageMetadata()` (formats input, candidate, and total tokens for clean terminal display).

3. **[`src/streaming.mjs`](file:///home/poorti/Desktop/training2.0/Day1/src/streaming.mjs)**
   Provides `streamContent()` — an asynchronous generator (`async *`) yielding `{ text, usageMetadata }` chunks as they arrive over HTTP streaming.

4. **[`src/json-mode.mjs`](file:///home/poorti/Desktop/training2.0/Day1/src/json-mode.mjs)**
   Provides `defaultOutputSchema` and `generateStructuredJSON()`. Enforces strict schemas and safely parses the resulting JSON.

5. **[`src/tool-calling.mjs`](file:///home/poorti/Desktop/training2.0/Day1/src/tool-calling.mjs)**
   Provides `weatherToolDeclaration`, `defaultWeatherToolHandler()`, and `executeToolLoop()`. Manages the full multi-turn cycle: sending prompt, detecting function calls, executing local functions, and returning function responses to Gemini.

---

## 4. Usage Examples

### 1. Real-time Token Streaming
Streams tokens to `stdout` as they arrive, estimating prompt tokens beforehand and logging total token counts when complete.
```bash
./ask-gemini.mjs "Explain the difference between TCP and UDP in 3 bullet points"
```

### 2. Schema-Validated Structured JSON Output
Enforces a strict schema returning `query`, `summary`, `keyPoints`, and `confidenceScore`.
```bash
./ask-gemini.mjs "Compare Redis and Memcached for distributed caching" --json
```
**Sample Output:**
```json
{
  "query": "Compare Redis and Memcached for distributed caching",
  "summary": "Redis is a rich data structure store with persistence, while Memcached is a lightweight multi-threaded key-value store.",
  "keyPoints": [
    "Redis supports lists, sets, hashes, bitmaps, and pub/sub.",
    "Memcached offers simple string key-value caching with multi-threaded scaling.",
    "Redis supports disk persistence (RDB/AOF); Memcached is purely in-memory."
  ],
  "confidenceScore": 0.98
}
```

### 3. Tool / Function Calling Mode
Demonstrates multi-turn function execution. The model requests `getCurrentWeather`, the local handler executes, and the model synthesizes the final response.
```bash
./ask-gemini.mjs "What is the weather in Amsterdam right now?" --tool
```

### 4. Custom Model & System Persona
```bash
./ask-gemini.mjs "Explain how Raft consensus works" -s "You are a distributed systems professor." --temperature 0.2
```

---

## 5. Resilience Architecture

### Exponential Backoff with Full Jitter
Calls to Gemini are wrapped with `withRetry()` in `gemini-client.mjs`:
- **Target Errors**: Catches HTTP `429` (rate limits), `500`/`502`/`503`/`504` (temporary service unavailable / high demand), and socket connection resets (`ECONNRESET`, `ETIMEDOUT`).
- **Formula**:
  $$\text{Delay} = 2^{\text{attempt}} \times \text{baseDelayMs} + \text{RandomJitter}(0 \text{ to } 500\text{ms})$$
- **Graceful Reporting**: Logs warning notifications showing retry attempt count and backoff delay without terminating the process.

---

## 6. Automated Verification Test Suite

Run the full end-to-end verification suite:
```bash
npm test
```
Verifies:
1. `countTokens`: Token calculation before generation.
2. `streamGenerate`: Async generator yielding stream chunks.
3. `generateJSON`: Strict schema enforcement and JSON validation.
4. `executeToolCall`: Multi-turn function declaration and result synthesis.
5. `withRetry`: Exponential backoff recovery upon simulated transient 503 errors.

---

## 7. Interview Hour Reference

1. **What is a Token?**
   A token is the atomic unit of text (roughly 3–4 characters or ¾ of a word in English) that an LLM ingests, embeds, and predicts via a tokenizer. Models operate on numerical token IDs rather than raw characters or full words.

2. **What is a Context Window?**
   The context window is the hard ceiling on the total number of tokens (prompt, history, system instructions, and generated output combined) a model can hold in working memory for a single call. Any content exceeding this threshold is truncated or causes the request to fail.

3. **Temperature vs. Top-P**
   Temperature scales logit probabilities to control randomness (0 is greedy and factual; higher values increase variety and creativity). Top-P (nucleus sampling) truncates the distribution so the model only samples from the smallest subset of tokens whose cumulative probability reaches threshold $P$.

4. **Why Outputs Are Non-Deterministic**
   Non-determinism stems from probabilistic token sampling when temperature $> 0$, where the next token is chosen from a probability distribution. Even at temperature 0, parallel GPU floating-point operations (non-associative addition) can introduce micro-deviations that alter token selection.

5. **Prompt vs. System Instruction**
   System instructions establish persistent behavioral rules, safety boundaries, persona, and output constraints prior to dialogue. The user prompt provides the specific dynamic input or task to be executed within that established framework.

6. **Cost Drivers**
   LLM billing is driven primarily by token volume split into input and output tokens, with output tokens being significantly more expensive due to sequential autoregressive generation. Secondary cost drivers include context caching hits/misses, multimodal payloads (images/audio/video), and multi-turn tool-calling loops.
