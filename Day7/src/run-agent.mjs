#!/usr/bin/env node
/**
 * Day 7 — MCP Operations CLI Runner
 * Runs either the dynamic MCP Gemini Agent or the MCP LangGraph StateGraph pipeline.
 *
 * Usage:
 *   npm start                                  (Runs Gemini Agent with default audit task)
 *   node src/run-agent.mjs "Find suppliers for compute category"
 *   node src/run-agent.mjs --langgraph         (Runs LangGraph Multi-Node Pipeline)
 */

import { parseArgs } from 'node:util';
import { MCPGeminiAgent } from './agent-gemini.mjs';
import { createMCPLangGraphAgent } from './agent-langgraph.mjs';

const colors = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  magenta: '\x1b[35m',
  blue:    '\x1b[34m',
  red:     '\x1b[31m'
};

const c = (color, text) => `${colors[color]}${text}${colors.reset}`;

const optionsConfig = {
  langgraph: { type: 'boolean', default: false },
  prompt: { type: 'string', short: 'p' },
  help: { type: 'boolean', short: 'h', default: false }
};

const { values, positionals } = parseArgs({
  options: optionsConfig,
  allowPositionals: true,
  strict: false
});

if (values.help) {
  console.log(`
${c('bold', c('cyan', 'Day 7 MCP Operations Runner'))}

${c('bold', 'USAGE:')}
  node src/run-agent.mjs [options] [prompt]

${c('bold', 'OPTIONS:')}
  --langgraph          Run LangGraph StateGraph MCP pipeline
  -p, --prompt <text>  Prompt for the autonomous Gemini Agent
  -h, --help           Show help
`);
  process.exit(0);
}

console.log('\n' + c('bold', c('cyan', '╔══════════════════════════════════════════════════════════════════╗')));
console.log(c('bold', c('cyan', '║   DAY 7 — MODEL CONTEXT PROTOCOL (MCP) CLIENT & AGENT RUNNER     ║')));
console.log(c('bold', c('cyan', '╚══════════════════════════════════════════════════════════════════╝')) + '\n');

if (values.langgraph) {
  console.log(c('bold', c('yellow', 'Mode: LangGraph MCP StateGraph Pipeline\n')));
  const agent = createMCPLangGraphAgent();

  try {
    const result = await agent.execute();
    console.log(c('bold', c('green', '✔ Execution Complete!')));
    console.log('\n' + c('bold', 'Pipeline Logs:'));
    result.logs.forEach(log => console.log('  ' + c('dim', log)));

    console.log('\n' + c('bold', 'Orders Placed via MCP:'));
    console.table(result.placedOrders);

    console.log('\n' + c('bold', 'Verified Database Records:'));
    console.table(result.verifiedOrders);
  } finally {
    await agent.bridge.close();
  }
} else {
  const prompt = values.prompt || positionals.join(' ') ||
    'Identify all products that are low in stock (stock_quantity <= reorder_level), get their supplier details, and create restock purchase orders for each.';

  console.log(c('bold', c('yellow', 'Mode: Autonomous MCP Gemini Agent')));
  console.log(c('bold', 'Goal: ') + c('cyan', prompt) + '\n');

  const agent = new MCPGeminiAgent();

  try {
    const result = await agent.execute(prompt, {
      onStep: (step) => {
        if (step.type === 'tool_call') {
          console.log(c('bold', c('magenta', `[MCP Client -> Server]`)) + ` Invoking tool ${c('yellow', step.name)}:`, JSON.stringify(step.args));
        } else if (step.type === 'tool_result') {
          console.log(c('bold', c('green', `[MCP Server -> Client]`)) + ` Tool ${c('yellow', step.name)} returned result.`);
        }
      }
    });

    console.log('\n' + c('bold', c('green', '════════════════════════ Agent Report ════════════════════════')));
    console.log(result.finalAnswer);
    console.log(c('bold', c('green', '══════════════════════════════════════════════════════════════')));
  } finally {
    await agent.close();
  }
}
