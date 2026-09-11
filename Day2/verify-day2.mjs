import {
  createAgent,
  ToolRegistry,
  AgentMemory,
  calculatorToolDeclaration,
  calculatorToolHandler,
  searchToolDeclaration,
  searchToolHandler,
  colors
} from './agent.mjs';

function pass(name, details = '') {
  console.log(`${colors.green}✔ PASS:${colors.reset} ${colors.bold}${name}${colors.reset} ${details}`);
}

function fail(name, err) {
  console.error(`${colors.red}✖ FAIL:${colors.reset} ${colors.bold}${name}${colors.reset}`);
  console.error(err);
  process.exit(1);
}

async function runTests() {
  console.log(`\n${colors.cyan}${colors.bold}=== Day 2 ReAct Autonomous Agent Verification Suite ===${colors.reset}\n`);

  // -------------------------------------------------------------
  // Test 1: Calculator Tool (Correctness, Percentages, and Safety)
  // -------------------------------------------------------------
  try {
    // 1a. Standard arithmetic
    const res1 = await calculatorToolHandler({ expression: '68373433 * 0.15' });
    if (Math.abs(res1.result - 10256014.95) > 0.001) {
      throw new Error(`Calculator failed: expected 10256014.95, got ${res1.result}`);
    }

    // 1b. Percentage of expression
    const res2 = await calculatorToolHandler({ expression: '15% of 68373433' });
    if (Math.abs(res2.result - 10256014.95) > 0.001) {
      throw new Error(`Percentage calculation failed: expected 10256014.95, got ${res2.result}`);
    }

    // 1c. Division by zero safety
    const res3 = await calculatorToolHandler({ expression: '100 / 0' });
    if (!res3.error) {
      throw new Error('Calculator should return error on division by zero.');
    }

    // 1d. Dangerous injection prevention
    const res4 = await calculatorToolHandler({ expression: 'process.exit(1)' });
    if (!res4.error) {
      throw new Error('Calculator should reject unauthorized tokens.');
    }

    pass('Calculator Tool', `(68373433 * 0.15 = ${res1.result}, safe sandboxing verified)`);
  } catch (err) {
    fail('Calculator Tool', err);
  }

  // -------------------------------------------------------------
  // Test 2: Search Tool Stub (Knowledge Base & Fallback)
  // -------------------------------------------------------------
  try {
    const searchRes = await searchToolHandler({ query: 'What is the population of France?' });
    if (!searchRes.found || searchRes.data?.country !== 'France' || searchRes.data?.population !== 68373433) {
      throw new Error(`Search stub failed for France: ${JSON.stringify(searchRes)}`);
    }

    const fallbackRes = await searchToolHandler({ query: 'nonexistent_country_xyz_12345' });
    if (fallbackRes.found) {
      throw new Error('Search stub should return found: false for unknown queries.');
    }

    pass('Search Tool Stub', `(Found France population: ${searchRes.data.population.toLocaleString('en-US')}, fallback handled)`);
  } catch (err) {
    fail('Search Tool Stub', err);
  }

  // -------------------------------------------------------------
  // Test 3: Tool Registry (Declaration & Safe Dispatch)
  // -------------------------------------------------------------
  try {
    const registry = ToolRegistry.createDefault();
    const declarations = registry.getFunctionDeclarations();

    if (declarations.length !== 2) {
      throw new Error(`Expected 2 tool declarations, got ${declarations.length}`);
    }

    const toolNames = declarations.map(d => d.name);
    if (!toolNames.includes('calculator') || !toolNames.includes('search_web')) {
      throw new Error(`Expected calculator and search_web in registry, got: ${toolNames.join(', ')}`);
    }

    // Test unknown tool dispatch
    const unknownRes = await registry.execute('nonexistent_tool', {});
    if (!unknownRes.error) {
      throw new Error('Registry should return error object when executing unregistered tool.');
    }

    pass('Tool Registry & Dispatcher', `(Declarations: [${toolNames.join(', ')}], safe dispatch verified)`);
  } catch (err) {
    fail('Tool Registry & Dispatcher', err);
  }

  // -------------------------------------------------------------
  // Test 4: Working Memory & Scratchpad State Tracking
  // -------------------------------------------------------------
  try {
    const memory = new AgentMemory();
    memory.startTask('Calculate 15% of France population');

    memory.recordStep({
      step: 1,
      thought: 'Need to look up population of France',
      action: { name: 'search_web', args: { query: 'population of France' } },
      observation: { population: 68373433 },
      durationMs: 42
    });

    memory.recordStep({
      step: 2,
      thought: 'Now calculate 15%',
      action: { name: 'calculator', args: { expression: '68373433 * 0.15' } },
      observation: { result: 10256014.95 },
      durationMs: 5
    });

    memory.setFinalAnswer('The answer is 10,256,015', 'completed');

    const trace = memory.getTrace();
    const summary = memory.getSummary();

    if (trace.length !== 2 || summary.totalSteps !== 2 || !summary.completed) {
      throw new Error(`Memory state error: traceLength=${trace.length}, completed=${summary.completed}`);
    }

    pass('Working Memory & Scratchpad', `(Tracked ${trace.length} steps, tools: [${summary.toolsUsed.join(', ')}])`);
  } catch (err) {
    fail('Working Memory & Scratchpad', err);
  }

  // -------------------------------------------------------------
  // Test 5: End-to-End ReAct Agent Loop (Multi-Step Goal)
  // -------------------------------------------------------------
  try {
    const agent = createAgent();
    const prompt = 'What is 15% of the population of France?';

    const result = await agent.run(prompt, {
      maxIterations: 5,
      quiet: true // Run quietly in automated test
    });

    if (!result.success) {
      throw new Error(`Agent loop failed: stopReason=${result.stopReason}, answer=${result.answer}`);
    }

    const toolsUsed = result.summary.toolsUsed;
    const usedSearch = toolsUsed.includes('search_web');
    const usedCalc = toolsUsed.includes('calculator');

    if (!usedSearch || !usedCalc) {
      throw new Error(`Expected agent to use both search_web and calculator. Tools used: [${toolsUsed.join(', ')}]`);
    }

    // Verify answer contains expected calculation value (~10,256,014 or 10.25 million)
    const normalizedAns = result.answer.replace(/,/g, '');
    const containsNumber = normalizedAns.includes('10256014') ||
                           normalizedAns.includes('10256015') ||
                           normalizedAns.includes('10.25') ||
                           normalizedAns.includes('10,256,015');

    if (!containsNumber) {
      throw new Error(`Agent answer did not contain the calculated value: "${result.answer}"`);
    }

    pass('End-to-End ReAct Agent Loop', `(Multi-step solved in ${result.iterations} turns using [${toolsUsed.join(' → ')}])`);
  } catch (err) {
    fail('End-to-End ReAct Agent Loop', err);
  }

  // -------------------------------------------------------------
  // Test 6: Guardrails & Max-Iteration Cap Enforcement
  // -------------------------------------------------------------
  try {
    const agent = createAgent();
    // A multi-step question requires at least 2 tool steps (search + calculate) + 1 final step = 3 turns.
    // Setting maxIterations to 1 forces the guardrail cutoff to trigger.
    const result = await agent.run('What is 15% of the population of France?', {
      maxIterations: 1,
      quiet: true
    });

    if (result.success !== false) {
      throw new Error(`Expected agent to halt on iteration cap, but reported success.`);
    }

    if (result.stopReason !== 'max_iterations_reached') {
      throw new Error(`Expected stopReason "max_iterations_reached", got "${result.stopReason}"`);
    }

    if (result.iterations !== 1) {
      throw new Error(`Expected iterations=1, got ${result.iterations}`);
    }

    pass('Guardrail Max-Iteration Cap', `(Successfully halted at cutoff iteration 1 with stopReason="${result.stopReason}")`);
  } catch (err) {
    fail('Guardrail Max-Iteration Cap', err);
  }

  console.log(`\n${colors.green}${colors.bold}All 6 Day 2 verification suites passed successfully!${colors.reset}\n`);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
