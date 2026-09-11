import { ToolRegistry } from './tools/registry.mjs';
import { AgentMemory } from './memory.mjs';
import { AgentLogger } from './logger.mjs';

/**
 * Default ReAct prompt that guides the model to reason, use tools, and provide a final answer.
 */
export const DEFAULT_SYSTEM_INSTRUCTION = `You are an autonomous problem-solving agent operating in a ReAct (Reason + Act) loop.

CORE OPERATING PRINCIPLES:
1. PERCEIVE: Analyze the user's objective and available context carefully.
2. DECIDE: Break complex multi-step problems into smaller atomic actions.
3. ACT:
   - For factual knowledge, statistics, demographics, or population data, invoke the 'search_web' tool.
   - For numerical calculations, percentages, or arithmetic, NEVER calculate in your head—ALWAYS invoke the 'calculator' tool.
4. OBSERVE: Examine the tool's returned output, integrate the finding, and determine the next step.
5. FINISH: When you have all required information to completely answer the user's question, provide a comprehensive final answer WITHOUT calling any more tools.`;

/**
 * Runs the autonomous ReAct agent loop.
 *
 * @param {Object} params
 * @param {Object} params.ai - Initialized GoogleGenAI instance
 * @param {string} [params.model='gemini-3.5-flash-lite'] - Target Gemini model
 * @param {string} params.prompt - User task or multi-step question
 * @param {ToolRegistry} [params.registry] - Tool registry containing available tools
 * @param {AgentMemory} [params.memory] - Memory / scratchpad instance
 * @param {AgentLogger} [params.logger] - Logger instance
 * @param {number} [params.maxIterations=5] - Maximum loop iterations before safety cutoff
 * @param {number} [params.temperature=0.1] - Sampling temperature (low for deterministic logic)
 * @param {string} [params.systemInstruction] - Custom system instruction
 * @param {Function} [params.onStep] - Optional callback triggered after each step
 * @returns {Promise<{ success: boolean, answer: string, iterations: number, trace: Array<Object>, summary: Object, stopReason: string, usageMetadata?: Object }>}
 */
export async function runAgentLoop({
  ai,
  model = 'gemini-3.5-flash-lite',
  prompt,
  registry = ToolRegistry.createDefault(),
  memory = new AgentMemory(),
  logger = new AgentLogger(),
  maxIterations = 5,
  temperature = 0.1,
  systemInstruction = DEFAULT_SYSTEM_INSTRUCTION,
  onStep = null
}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Agent loop requires a non-empty prompt string.');
  }

  // 1. Initialize scratchpad working memory
  memory.startTask(prompt);
  logger.taskInfo(prompt, {
    model,
    maxIterations,
    tools: registry.list().map(t => t.name)
  });

  // 2. Initialize the Gemini multi-turn chat session with tool declarations
  const declarations = registry.getFunctionDeclarations();
  const chat = ai.chats.create({
    model,
    config: {
      temperature,
      systemInstruction,
      tools: [{ functionDeclarations: declarations }]
    }
  });

  let iteration = 0;
  let nextMessage = prompt;
  let lastUsage = null;

  // 3. The Core ReAct Loop: [Perceive -> Decide -> Act -> Observe]
  while (iteration < maxIterations) {
    iteration++;
    logger.stepHeader(iteration, maxIterations);

    const stepStartTime = Date.now();
    let turn;

    try {
      turn = await chat.sendMessage({ message: nextMessage });
    } catch (apiErr) {
      // If the API call fails, record and abort
      const errorMsg = `API Turn Error at iteration ${iteration}: ${apiErr.message}`;
      memory.recordStep({
        step: iteration,
        thought: 'Error communicating with Gemini API',
        action: { name: 'api_call', args: {} },
        observation: { error: errorMsg }
      });
      memory.setFinalAnswer(null, 'api_error');
      logger.guardrail(errorMsg, iteration);

      return {
        success: false,
        answer: errorMsg,
        iterations: iteration,
        trace: memory.getTrace(),
        summary: memory.getSummary(),
        stopReason: 'api_error'
      };
    }

    if (turn.usageMetadata) {
      lastUsage = turn.usageMetadata;
    }

    const functionCalls = turn.functionCalls;

    // -------------------------------------------------------------
    // STOP CONDITION CHECK:
    // If the model does not request any function calls, it has decided
    // that it has all facts and calculations necessary to answer.
    // -------------------------------------------------------------
    if (!functionCalls || functionCalls.length === 0) {
      const finalAnswerText = turn.text?.trim() || 'No text output produced.';
      const stepDuration = Date.now() - stepStartTime;

      memory.recordStep({
        step: iteration,
        thought: 'All information gathered. Formulating final answer.',
        observation: { status: 'COMPLETE', finalAnswer: finalAnswerText },
        durationMs: stepDuration
      });
      memory.setFinalAnswer(finalAnswerText, 'completed');

      logger.finalAnswer(finalAnswerText);
      const summary = memory.getSummary();
      logger.traceSummary(summary, lastUsage);

      if (typeof onStep === 'function') {
        onStep({ iteration, phase: 'FINISH', answer: finalAnswerText, trace: memory.getTrace() });
      }

      return {
        success: true,
        answer: finalAnswerText,
        iterations: iteration,
        trace: memory.getTrace(),
        summary,
        stopReason: 'completed',
        usageMetadata: lastUsage
      };
    }

    // -------------------------------------------------------------
    // ACT & OBSERVE:
    // Model proposed one or more tool calls. Execute them via registry.
    // -------------------------------------------------------------
    const functionResponses = [];

    for (const call of functionCalls) {
      const toolName = call.name;
      const toolArgs = call.args || {};

      logger.action(toolName, toolArgs);

      const toolStart = Date.now();
      const toolResult = await registry.execute(toolName, toolArgs);
      const toolDuration = Date.now() - toolStart;

      logger.observation(toolResult, toolDuration);

      // Record step in working memory / scratchpad
      memory.recordStep({
        step: iteration,
        action: { name: toolName, args: toolArgs },
        observation: toolResult,
        durationMs: toolDuration
      });

      // Prepare functionResponse part for the next chat turn
      functionResponses.push({
        functionResponse: {
          name: toolName,
          response: toolResult
        }
      });
    }

    if (typeof onStep === 'function') {
      onStep({ iteration, phase: 'TOOL_EXECUTED', calls: functionCalls, responses: functionResponses });
    }

    // Prepare message payload to feed tool observation back into the model
    nextMessage = functionResponses;
  }

  // -------------------------------------------------------------
  // GUARDRAIL SAFETY CUTOFF:
  // If we reach here, the loop exceeded maxIterations without finishing.
  // -------------------------------------------------------------
  const stopReason = 'max_iterations_reached';
  const cutoffMessage = `Agent exceeded maximum iteration cap of ${maxIterations} steps without reaching a final answer.`;
  memory.setFinalAnswer(cutoffMessage, stopReason);

  logger.guardrail(cutoffMessage, maxIterations);
  const summary = memory.getSummary();
  logger.traceSummary(summary, lastUsage);

  return {
    success: false,
    answer: cutoffMessage,
    iterations: maxIterations,
    trace: memory.getTrace(),
    summary,
    stopReason,
    usageMetadata: lastUsage
  };
}
