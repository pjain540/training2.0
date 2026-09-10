import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Re-export modular components for direct external consumption
export { withRetry, isTransientError } from './src/retry.mjs';
export { countInputTokens, formatUsageMetadata } from './src/tokens.mjs';
export { streamContent } from './src/streaming.mjs';
export { defaultOutputSchema, generateStructuredJSON } from './src/json-mode.mjs';
export { weatherToolDeclaration, defaultWeatherToolHandler, executeToolLoop } from './src/tool-calling.mjs';

import { withRetry } from './src/retry.mjs';
import { countInputTokens } from './src/tokens.mjs';
import { streamContent } from './src/streaming.mjs';
import { defaultOutputSchema, generateStructuredJSON } from './src/json-mode.mjs';
import { weatherToolDeclaration, defaultWeatherToolHandler, executeToolLoop } from './src/tool-calling.mjs';

// Automatically load .env located in the Day1 directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

/**
 * Creates a unified Gemini client facade that orchestrates all modular capabilities.
 *
 * @param {Object} [config]
 * @param {string} [config.apiKey=process.env.GEMINI_API_KEY]
 * @param {string} [config.defaultModel='gemini-3.6-flash']
 */
export function createGeminiClient({
  apiKey = process.env.GEMINI_API_KEY,
  defaultModel = 'gemini-3.5-flash-lite'
} = {}) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not defined. Set it in .env or pass it to createGeminiClient.');
  }

  const ai = new GoogleGenAI({ apiKey });

  return {
    ai,
    defaultModel,

    /**
     * Pre-count input prompt tokens.
     */
    async countTokens(contents, model = defaultModel) {
      return countInputTokens(ai, model, contents);
    },

    /**
     * Stream response tokens in real-time.
     */
    async *streamGenerate(prompt, options = {}) {
      const model = options.model || defaultModel;
      yield* streamContent(ai, model, prompt, options);
    },

    /**
     * Generate schema-validated JSON.
     */
    async generateJSON(prompt, options = {}) {
      const model = options.model || defaultModel;
      return generateStructuredJSON(ai, model, prompt, options);
    },

    /**
     * Execute a function/tool calling loop.
     */
    async executeToolCall(prompt, options = {}) {
      const model = options.model || defaultModel;
      return executeToolLoop(ai, model, prompt, options);
    }
  };
}
