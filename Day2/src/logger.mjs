/**
 * ANSI Color Codes for beautiful terminal output.
 */
export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[90m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  bgBlue: '\x1b[44m',
  bgYellow: '\x1b[43m',
  bgRed: '\x1b[41m'
};

/**
 * Terminal logger for the autonomous ReAct agent loop.
 * Provides visible step-by-step trace logging.
 */
export class AgentLogger {
  constructor({ quiet = false } = {}) {
    this.quiet = quiet;
  }

  banner(title = 'GEMINI AUTONOMOUS ReAct AGENT') {
    if (this.quiet) return;
    console.log(`\n${colors.cyan}${colors.bold}================================================================${colors.reset}`);
    console.log(`${colors.cyan}${colors.bold}  🤖 ${title}${colors.reset}`);
    console.log(`${colors.cyan}${colors.bold}================================================================${colors.reset}\n`);
  }

  taskInfo(task, { model, maxIterations, tools = [] } = {}) {
    if (this.quiet) return;
    console.log(`${colors.bold}🎯 User Goal:${colors.reset} ${colors.yellow}"${task}"${colors.reset}`);
    console.log(`${colors.dim}⚙️  Config: Model=${model} | Max Iterations=${maxIterations} | Tools=[${tools.join(', ')}]${colors.reset}\n`);
    console.log(`${colors.dim}----------------------------------------------------------------${colors.reset}`);
  }

  stepHeader(iteration, maxIterations) {
    if (this.quiet) return;
    console.log(`\n${colors.bold}${colors.blue}┌── [Iteration ${iteration}/${maxIterations}] 🧠 PERCEIVE & DECIDE${colors.reset}`);
  }

  thought(thoughtText) {
    if (this.quiet || !thoughtText) return;
    console.log(`${colors.blue}│${colors.reset}  ${colors.magenta}💭 Thought:${colors.reset} ${thoughtText}`);
  }

  action(toolName, args) {
    if (this.quiet) return;
    console.log(`${colors.blue}│${colors.reset}  ${colors.yellow}⚡ ACT (Tool Dispatch):${colors.reset} ${colors.bold}${toolName}${colors.reset}(${JSON.stringify(args)})`);
  }

  observation(result, durationMs = 0) {
    if (this.quiet) return;
    const timeStr = durationMs ? ` ${colors.dim}(${durationMs}ms)${colors.reset}` : '';
    const formatted = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
    const indented = formatted.split('\n').map(line => `│     ${line}`).join('\n');
    console.log(`${colors.blue}│${colors.reset}  ${colors.green}👁️ OBSERVE (Tool Result):${colors.reset}${timeStr}`);
    console.log(`${colors.green}${indented}${colors.reset}`);
    console.log(`${colors.blue}└──${colors.reset}`);
  }

  finalAnswer(answer) {
    if (this.quiet) return;
    console.log(`\n${colors.green}${colors.bold}================================================================${colors.reset}`);
    console.log(`${colors.green}${colors.bold}🎉 FINAL ANSWER (Agent Loop Completed):${colors.reset}`);
    console.log(`${colors.bold}${answer}${colors.reset}`);
    console.log(`${colors.green}${colors.bold}================================================================${colors.reset}\n`);
  }

  guardrail(reason, iterations) {
    if (this.quiet) return;
    console.log(`\n${colors.red}${colors.bold}================================================================${colors.reset}`);
    console.log(`${colors.red}${colors.bold}⚠️  GUARDRAIL TRIGGERED: ${reason} (After ${iterations} iterations)${colors.reset}`);
    console.log(`${colors.red}${colors.bold}================================================================${colors.reset}\n`);
  }

  traceSummary(summary, usageMetadata) {
    if (this.quiet) return;
    console.log(`${colors.cyan}${colors.bold}📊 Execution Trace Summary:${colors.reset}`);
    console.log(`  • Status:           ${summary.completed ? colors.green + 'SUCCESS' : colors.red + 'STOPPED (' + summary.stopReason + ')'}${colors.reset}`);
    console.log(`  • Iterations/Steps: ${summary.totalSteps}`);
    console.log(`  • Tools Invoked:    ${summary.toolsUsed.length > 0 ? summary.toolsUsed.join(' → ') : 'None'}`);
    console.log(`  • Total Latency:    ${summary.durationMs}ms`);

    if (usageMetadata) {
      const promptTok = usageMetadata.promptTokenCount ?? usageMetadata.promptTokens ?? 0;
      const respTok = usageMetadata.candidatesTokenCount ?? usageMetadata.outputTokens ?? 0;
      const totalTok = usageMetadata.totalTokenCount ?? usageMetadata.totalTokens ?? 0;
      console.log(`  • Tokens Consumed:  ${totalTok} total (Prompt: ${promptTok}, Output: ${respTok})`);
    }
    console.log(`${colors.dim}----------------------------------------------------------------${colors.reset}\n`);
  }
}
