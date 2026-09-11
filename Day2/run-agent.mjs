#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { createAgent, colors } from './agent.mjs';

// 1. Configure CLI Arguments
const optionsConfig = {
  prompt: { type: 'string', short: 'p' },
  model: { type: 'string', default: 'gemini-3.5-flash-lite' },
  'max-iterations': { type: 'string', short: 'm', default: '5' },
  temperature: { type: 'string', short: 't', default: '0.1' },
  json: { type: 'boolean', default: false },
  quiet: { type: 'boolean', short: 'q', default: false },
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
  console.error(`${colors.red}Argument parsing error: ${err.message}${colors.reset}`);
  process.exit(1);
}

const { values, positionals } = parsed;

// 2. Help Documentation
if (values.help || (!values.prompt && positionals.length === 0)) {
  console.log(`
${colors.bold}${colors.cyan}run-agent${colors.reset} - Hand-Rolled Autonomous ReAct Agent CLI

${colors.bold}USAGE:${colors.reset}
  node run-agent.mjs "<prompt>" [options]
  node run-agent.mjs -p "<prompt>" [options]
  ./run-agent.mjs "<prompt>" [options]

${colors.bold}OPTIONS:${colors.reset}
  -p, --prompt <string>          Input question / multi-step objective
  -m, --max-iterations <number>  Maximum loop iterations before guardrail cutoff (default: 5)
  --model <string>               Gemini model (default: "gemini-3.5-flash-lite")
  -t, --temperature <number>     Sampling temperature (default: 0.1)
  --json                         Output the complete JSON execution trace at the end
  -q, --quiet                    Suppress step-by-step trace formatting
  -h, --help                     Display this help menu

${colors.bold}EXAMPLES:${colors.reset}
  # 1. Multi-step calculation requiring Search + Math Calculator:
  node run-agent.mjs "What is 15% of the population of France?"

  # 2. Science lookup + arithmetic:
  node run-agent.mjs "How many seconds would it take light to travel from the Earth to the Moon?"

  # 3. Test iteration guardrail cutoff:
  node run-agent.mjs "What is 15% of the population of France?" --max-iterations 1

  # 4. Export full JSON execution trace:
  node run-agent.mjs "What is 15% of the population of France?" --json
`);
  process.exit(0);
}

// 3. Resolve Prompt and Configuration
const prompt = values.prompt || positionals.join(' ').trim();
const model = values.model;
const maxIterations = parseInt(values['max-iterations'], 10);
const temperature = parseFloat(values.temperature);

if (!prompt) {
  console.error(`${colors.red}Error: Prompt cannot be empty.${colors.reset}`);
  process.exit(1);
}

// 4. Initialize and Run Agent
async function main() {
  let agent;
  try {
    agent = createAgent({ defaultModel: model, defaultMaxIterations: maxIterations });
  } catch (initErr) {
    console.error(`${colors.red}Initialization Error: ${initErr.message}${colors.reset}`);
    process.exit(1);
  }

  const result = await agent.run(prompt, {
    model,
    maxIterations,
    temperature,
    quiet: values.quiet
  });

  if (values.json) {
    console.log(`\n${colors.cyan}${colors.bold}=== FULL JSON EXECUTION TRACE ===${colors.reset}`);
    console.log(JSON.stringify(result, null, 2));
  }

  if (!result.success && result.stopReason === 'max_iterations_reached') {
    process.exit(2);
  }
}

main().catch(err => {
  console.error(`\n${colors.red}Unhandled Agent Error: ${err.message}${colors.reset}`);
  process.exit(1);
});
