import { Type } from '@google/genai';
import { withRetry } from './retry.mjs';

/**
 * Standard output schema for structured CLI answers.
 */
export const defaultOutputSchema = {
  type: Type.OBJECT,
  description: 'Schema-validated structured response for CLI output',
  properties: {
    query: {
      type: Type.STRING,
      description: 'The summarized question or prompt intent'
    },
    summary: {
      type: Type.STRING,
      description: 'The core answer or resolution'
    },
    keyPoints: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Actionable key points, steps, or insights'
    },
    confidenceScore: {
      type: Type.NUMBER,
      description: 'Confidence score between 0.0 and 1.0'
    }
  },
  required: ['query', 'summary', 'keyPoints', 'confidenceScore']
};

/**
 * Generates schema-validated structured JSON from Gemini.
 *
 * @param {Object} ai - Initialized GoogleGenAI instance
 * @param {string} model - Target model identifier
 * @param {string|Array} prompt - Input prompt text
 * @param {Object} [options]
 * @param {Object} [options.schema=defaultOutputSchema] - JSON schema to enforce
 * @param {number} [options.temperature=0.2] - Sampling temperature (lower is better for JSON)
 * @param {string} [options.systemInstruction] - System instruction
 * @param {Function} [options.onRetry] - Retry callback
 * @returns {Promise<{ data: Object, rawText: string, usageMetadata: Object }>}
 */
export async function generateStructuredJSON(ai, model, prompt, {
  schema = defaultOutputSchema,
  temperature = 0.2,
  systemInstruction,
  onRetry
} = {}) {
  return withRetry(async () => {
    const res = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature,
        responseMimeType: 'application/json',
        responseSchema: schema,
        ...(systemInstruction ? { systemInstruction } : {})
      }
    });

    let parsedData;
    try {
      parsedData = JSON.parse(res.text);
    } catch (parseErr) {
      throw new Error(`Failed to parse model output as JSON: ${parseErr.message}\nRaw Text: ${res.text}`);
    }

    return {
      data: parsedData,
      rawText: res.text,
      usageMetadata: res.usageMetadata
    };
  }, { onRetry });
}
