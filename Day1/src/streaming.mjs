import { withRetry } from './retry.mjs';

/**
 * Streams content from Gemini using generateContentStream.
 * Returns an async generator yielding text chunks and tracking final usage metadata.
 *
 * @param {Object} ai - Initialized GoogleGenAI instance
 * @param {string} model - Target model identifier
 * @param {string|Array} prompt - Input prompt text
 * @param {Object} [options]
 * @param {number} [options.temperature=0.7] - Sampling temperature
 * @param {string} [options.systemInstruction] - System instruction
 * @param {Function} [options.onRetry] - Retry callback
 * @yields {{ text: string, usageMetadata: Object|null }}
 */
export async function* streamContent(ai, model, prompt, {
  temperature = 0.7,
  systemInstruction,
  onRetry
} = {}) {
  const stream = await withRetry(async () => {
    return await ai.models.generateContentStream({
      model,
      contents: prompt,
      config: {
        temperature,
        ...(systemInstruction ? { systemInstruction } : {})
      }
    });
  }, { onRetry });

  let finalUsage = null;
  for await (const chunk of stream) {
    if (chunk.usageMetadata) {
      finalUsage = chunk.usageMetadata;
    }
    if (chunk.text) {
      yield { text: chunk.text, usageMetadata: finalUsage };
    }
  }
  return finalUsage;
}
