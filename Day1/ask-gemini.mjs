#!/usr/bin/env node

import { parseArgs } from 'node:util';
import {
  createGeminiClient,
  weatherToolDeclaration,
  defaultWeatherToolHandler
} from './gemini-client.mjs';

// ANSI color helpers
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[90m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  blue: '\x1b[34m'
};

// 1. Parse Command Line Arguments
const optionsConfig = {
  prompt: { type: 'string', short: 'p' },
  json: { type: 'boolean', default: false },
  tool: { type: 'boolean', default: false },
  model: { type: 'string', default: 'gemini-3.6-flash' },
  temperature: { type: 'string', default: '0.7' },
  system: { type: 'string', short: 's' },
  help: { type: 'boolean', short: 'h', default: false }
};

let parsed;
try {
  parsed = parseArgs({
    options: optionsConfig,
    allowPositionals: true,
    strict: false
  });
} catch (err) {
  console.error(`${colors.red}Error parsing arguments: ${err.message}${colors.reset}`);
  process.exit(1);
}

const { values, positionals } = parsed;

// 2. Help Output
if (values.help || (!values.prompt && positionals.length === 0)) {
  console.log(`
${colors.bold}${colors.cyan}ask-gemini${colors.reset} - Resilient Gemini CLI Tool

${colors.bold}USAGE:${colors.reset}
  node ask-gemini.mjs "<prompt>" [options]
  node ask-gemini.mjs -p "<prompt>" [options]
  ./ask-gemini.mjs "<prompt>" [options]

${colors.bold}OPTIONS:${colors.reset}
  -p, --prompt <string>      Input prompt (or pass positionally without flag)
  --json                     Enforce schema-validated structured JSON output
  --tool                     Enable function calling mode (weather lookup demo)
  --model <string>           Model name (default: "gemini-3.6-flash")
  --temperature <number>     Sampling temperature (0.0 to 2.0, default: 0.7)
  -s, --system <string>      System instruction to guide model behavior
  -h, --help                 Show this help documentation

${colors.bold}EXAMPLES:${colors.reset}
  # 1. Real-time token streaming:
  ./ask-gemini.mjs "Explain the difference between TCP and UDP in 3 lines"

  # 2. Schema-validated structured JSON:
  ./ask-gemini.mjs "Compare Redis and PostgreSQL for caching" --json

  # 3. Tool execution:
  ./ask-gemini.mjs "What is the weather like in Tokyo right now?" --tool

  # 4. Custom model and system persona:
  ./ask-gemini.mjs "What is idempotency?" -s "You are a senior systems architect." --temperature 0.2
`);
  process.exit(0);
}

// 3. Resolve Prompt and Parameters
const prompt = values.prompt || positionals.join(' ').trim();
const model = values.model;
const temperature = parseFloat(values.temperature);
const systemInstruction = values.system;

if (!prompt) {
  console.error(`${colors.red}Error: Prompt cannot be empty.${colors.reset}`);
  process.exit(1);
}

// 4. Initialize Gemini Client
let client;
try {
  client = createGeminiClient({ defaultModel: model });
} catch (initErr) {
  console.error(`${colors.red}Initialization Error: ${initErr.message}${colors.reset}`);
  process.exit(1);
}

// Callback when transient error triggers a retry
function handleRetry(attempt, maxRetries, delayMs, err) {
  console.warn(
    `${colors.yellow}⚠️  [Retry ${attempt}/${maxRetries}] Transient error (${err.message || 'code ' + err.status}). Retrying in ${delayMs}ms...${colors.reset}`
  );
}

// Print token usage summary
function displayUsage(usage) {
  if (!usage) return;
  console.log(`\n${colors.dim}--------------------------------------------------${colors.reset}`);
  console.log(
    `${colors.dim}Token Usage: Prompt: ${usage.promptTokenCount ?? 'N/A'} | Candidates: ${usage.candidatesTokenCount ?? 'N/A'} | Total: ${usage.totalTokenCount ?? 'N/A'}${colors.reset}`
  );
}

// 5. Main Execution Flow
async function main() {
  console.log(
    `${colors.bold}${colors.cyan}► Model:${colors.reset} ${model} | ${colors.bold}${colors.cyan}JSON:${colors.reset} ${values.json} | ${colors.bold}${colors.cyan}Tool:${colors.reset} ${values.tool} | ${colors.bold}${colors.cyan}Temp:${colors.reset} ${temperature}`
  );

  // Pre-count prompt tokens
  try {
    const estimatedTokens = await client.countTokens(prompt, model);
    console.log(`${colors.dim}Estimated input prompt tokens: ${estimatedTokens}${colors.reset}\n`);
  } catch (countErr) {
    // Non-fatal estimation failure
  }

  if (values.tool) {
    // MODE A: Function / Tool Calling Flow
    console.log(`${colors.magenta}⚙ Mode: Function Calling enabled [Tool: ${weatherToolDeclaration.name}]${colors.reset}\n`);

    const result = await client.executeToolCall(prompt, {
      model,
      temperature,
      systemInstruction,
      tool: weatherToolDeclaration,
      handler: defaultWeatherToolHandler,
      onToolExecute: (name, args) => {
        console.log(`${colors.yellow}⚡ Model invoked tool: ${name}(${JSON.stringify(args)})${colors.reset}`);
        console.log(`${colors.green}✔ Tool returned live mock result to model.${colors.reset}\n`);
      },
      onRetry: handleRetry
    });

    console.log(result.text);
    displayUsage(result.usageMetadata);

  } else if (values.json) {
    // MODE B: Schema-Validated JSON Output Flow
    console.log(`${colors.magenta}⚙ Mode: Schema-Validated Structured JSON${colors.reset}\n`);

    const result = await client.generateJSON(prompt, {
      model,
      temperature,
      systemInstruction,
      onRetry: handleRetry
    });

    console.log(JSON.stringify(result.data, null, 2));
    displayUsage(result.usageMetadata);

  } else {
    // MODE C: Real-Time Token Streaming Flow
    console.log(`${colors.magenta}⚙ Mode: Real-Time Token Streaming${colors.reset}\n`);

    const generator = client.streamGenerate(prompt, {
      model,
      temperature,
      systemInstruction,
      onRetry: handleRetry
    });

    let lastUsage = null;
    for await (const chunk of generator) {
      process.stdout.write(chunk.text);
      if (chunk.usageMetadata) {
        lastUsage = chunk.usageMetadata;
      }
    }
    console.log();
    displayUsage(lastUsage);
  }
}

main().catch(err => {
  console.error(`\n${colors.red}Fatal Error: ${err.message}${colors.reset}`);
  process.exit(1);
});
