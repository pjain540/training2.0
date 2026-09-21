#!/usr/bin/env node
/**
 * Day 5 — Agent CLI Runner
 *
 * Runs the LangGraph ReAct agent (RAG tool + calculator) on a multi-step query
 * and shows the full tool-call trace.
 *
 * Usage:
 *   node run-agent.mjs "Look up the SLA uptime in NebulaCloud and calculate hours of downtime per year"
 *   node run-agent.mjs -p "..." --verbose
 */
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

import { createDay5Agent } from './src/agent.mjs';

// ─── CLI ──────────────────────────────────────────────────────────────────────

const { values, positionals } = parseArgs({
  options: {
    prompt:  { type: 'string',  short: 'p' },
    verbose: { type: 'boolean', short: 'v', default: false },
    chat:    { type: 'boolean', short: 'c', default: false },
    help:    { type: 'boolean', short: 'h', default: false }
  },
  allowPositionals: true,
  strict: false
});

const prompt = values.prompt ?? positionals[0];

if (values.help || (!prompt && !values.chat)) {
  console.log(`
\x1b[1m\x1b[36mrun-agent.mjs\x1b[0m — Day 5 LangGraph ReAct Agent CLI

\x1b[1mUSAGE:\x1b[0m
  node run-agent.mjs "<prompt>"
  node run-agent.mjs -p "<prompt>" [--verbose] [--chat]

\x1b[1mOPTIONS:\x1b[0m
  -p, --prompt <string>   The task or question for the agent
  -v, --verbose           Show LLM + tool call trace
  -c, --chat              Start interactive multi-turn chat session
  -h, --help              Show this help

\x1b[1mEXAMPLES:\x1b[0m
  # RAG-only query
  node run-agent.mjs "What security protocols does NebulaCloud use?"

  # Multi-tool: RAG + Calculator
  node run-agent.mjs "Look up the SLA uptime guarantee and calculate how many hours of downtime are allowed per year"

  # Verbose (see tool calls)
  node run-agent.mjs "What is the MTU for NebulaCloud?" --verbose

  # Interactive chat
  node run-agent.mjs --chat
`);
  process.exit(0);
}

// ─── Colours ──────────────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  red:    '\x1b[31m'
};

function banner(title) {
  console.log(`\n${C.bold}${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
  console.log(`${C.bold} ${title}${C.reset}`);
  console.log(`${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  banner('Day 5 — LangGraph ReAct Agent (RAG + Calculator)');

  console.log(`${C.dim}Initialising agent (ingesting knowledge base)…${C.reset}`);
  const { invoke } = await createDay5Agent({
    onStatus: msg => console.log(`  ${C.dim}${msg}${C.reset}`)
  });
  console.log(`\n${C.green}${C.bold}✅ Agent ready!${C.reset}\n`);

  if (values.chat) {
    // Interactive multi-turn chat
    const readline = await import('node:readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `${C.bold}${C.blue}You > ${C.reset}`
    });

    console.log(`${C.dim}Interactive chat session started. Type "exit" to quit.${C.reset}\n`);
    rl.prompt();

    rl.on('line', async (line) => {
      const input = line.trim();
      if (!input) { rl.prompt(); return; }
      if (input.toLowerCase() === 'exit') {
        console.log(`\n${C.dim}Goodbye!${C.reset}`);
        rl.close();
        process.exit(0);
      }

      try {
        const t0 = Date.now();
        const { answer, toolCalls } = await invoke(input, { verbose: values.verbose });
        const ms = Date.now() - t0;

        console.log(`\n${C.bold}${C.green}Agent > ${C.reset}${answer}`);
        if (toolCalls.length > 0) {
          console.log(`${C.dim}        [Tools used: ${toolCalls.join(', ')} | ${ms}ms]${C.reset}`);
        } else {
          console.log(`${C.dim}        [${ms}ms]${C.reset}`);
        }
        console.log();
      } catch (err) {
        console.error(`${C.red}[Agent Error]${C.reset} ${err.message}`);
      }

      rl.prompt();
    });
  } else {
    // Single-shot query
    console.log(`${C.bold}Prompt:${C.reset} ${prompt}\n`);

    const t0 = Date.now();
    const { answer, toolCalls } = await invoke(prompt, { verbose: values.verbose });
    const ms = Date.now() - t0;

    console.log(`${C.bold}${C.green}Answer:${C.reset}\n${answer}`);

    if (toolCalls.length > 0) {
      console.log(`\n${C.yellow}Tools called:${C.reset} ${toolCalls.join(' → ')}`);
    }

    console.log(`\n${C.dim}Total time: ${ms}ms${C.reset}`);
    console.log(`${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}\n`);
  }
}

main().catch(err => {
  console.error(`\x1b[31m[Fatal]\x1b[0m ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
