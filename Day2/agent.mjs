import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ToolRegistry } from './src/tools/registry.mjs';
import { calculatorToolDeclaration, calculatorToolHandler } from './src/tools/calculator.mjs';
import { searchToolDeclaration, searchToolHandler } from './src/tools/search.mjs';
import { AgentMemory } from './src/memory.mjs';
import { AgentLogger } from './src/logger.mjs';
import { runAgentLoop, DEFAULT_SYSTEM_INSTRUCTION } from './src/agent-loop.mjs';

// Re-export modular components for direct consumption
export { ToolRegistry } from './src/tools/registry.mjs';
export { calculatorToolDeclaration, calculatorToolHandler, sanitizeMathExpression } from './src/tools/calculator.mjs';
export { searchToolDeclaration, searchToolHandler } from './src/tools/search.mjs';
export { AgentMemory } from './src/memory.mjs';
export { AgentLogger, colors } from './src/logger.mjs';
export { runAgentLoop, DEFAULT_SYSTEM_INSTRUCTION } from './src/agent-loop.mjs';

// Load .env automatically
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

/**
 * Creates an autonomous ReAct agent instance.
 *
 * @param {Object} [config]
 * @param {string} [config.apiKey=process.env.GEMINI_API_KEY] - Gemini API Key
 * @param {string} [config.defaultModel='gemini-3.5-flash-lite'] - Default Gemini model
 * @param {number} [config.defaultMaxIterations=5] - Default iteration cutoff guardrail
 * @param {ToolRegistry} [config.registry] - Custom or preconfigured tool registry
 */
export function createAgent({
  apiKey = process.env.GEMINI_API_KEY,
  defaultModel = 'gemini-3.5-flash-lite',
  defaultMaxIterations = 5,
  registry = ToolRegistry.createDefault()
} = {}) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not defined. Set it in .env or pass it to createAgent.');
  }

  const ai = new GoogleGenAI({ apiKey });

  return {
    ai,
    defaultModel,
    defaultMaxIterations,
    registry,

    /**
     * Registers an additional custom tool.
     */
    registerTool(declaration, handler) {
      registry.register(declaration, handler);
      return this;
    },

    /**
     * Runs a goal or question through the autonomous ReAct agent loop.
     *
     * @param {string} prompt - Multi-step question or objective
     * @param {Object} [options]
     * @param {string} [options.model]
     * @param {number} [options.maxIterations]
     * @param {number} [options.temperature]
     * @param {string} [options.systemInstruction]
     * @param {boolean} [options.quiet]
     * @param {Function} [options.onStep]
     */
    async run(prompt, options = {}) {
      const model = options.model || defaultModel;
      const maxIterations = options.maxIterations || defaultMaxIterations;
      const memory = options.memory || new AgentMemory();
      const logger = options.logger || new AgentLogger({ quiet: options.quiet });

      return runAgentLoop({
        ai,
        model,
        prompt,
        registry: options.registry || registry,
        memory,
        logger,
        maxIterations,
        temperature: options.temperature ?? 0.1,
        systemInstruction: options.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION,
        onStep: options.onStep
      });
    }
  };
}
