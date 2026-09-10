import { withRetry } from './retry.mjs';

/**
 * Pre-counts input prompt tokens using Gemini's countTokens API.
 *
 * @param {Object} ai - Initialized GoogleGenAI instance
 * @param {string} model - Target model identifier
 * @param {string|Array} contents - Input prompt text or contents array
 * @param {Object} [retryOptions] - Options passed to withRetry
 * @returns {Promise<number>} Total token count for the input
 */
export async function countInputTokens(ai, model, contents, retryOptions = {}) {
  return withRetry(async () => {
    const res = await ai.models.countTokens({ model, contents });
    return res.totalTokens;
  }, retryOptions);
}

/**
 * Formats usage metadata for readable terminal or logging display.
 *
 * @param {Object} usage - usageMetadata object returned by Gemini
 * @returns {string} Formatted summary string
 */
export function formatUsageMetadata(usage) {
  if (!usage) return 'Usage: N/A';
  const input = usage.promptTokenCount ?? 'N/A';
  const output = usage.candidatesTokenCount ?? 'N/A';
  const total = usage.totalTokenCount ?? 'N/A';
  return `Token Usage: Prompt: ${input} | Candidates: ${output} | Total: ${total}`;
}
