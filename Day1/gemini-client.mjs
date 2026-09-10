import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Load .env relative to this file if not already populated
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

/**
 * Execute an async operation with exponential backoff and jitter.
 * Retries on transient HTTP statuses: 429 (rate limit), 500, 503 (high demand), and connection resets.
 */
export async function withRetry(fn, {
  maxRetries = 4,
  baseDelayMs = 1000,
  onRetry = null
} = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      const status = err.status || err.statusCode || (err.error && err.error.code);
      const isTransient =
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        (err.message && err.message.includes('experiencing high demand'));

      if (!isTransient || attempt > maxRetries) {
        throw err;
      }

      // Exponential backoff with full jitter: delay = 2^attempt * baseDelay + random
      const exponential = Math.pow(2, attempt) * baseDelayMs;
      const jitter = Math.random() * 500;
      const delay = Math.round(exponential + jitter);

      if (typeof onRetry === 'function') {
        onRetry(attempt, maxRetries, delay, err);
      }

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Default JSON schema for structured CLI output.
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
 * Default tool declaration for live weather lookups.
 */
export const weatherToolDeclaration = {
  name: 'getCurrentWeather',
  description: 'Get current temperature, conditions, and humidity for a specified location.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      location: {
        type: Type.STRING,
        description: 'City and state or country (e.g., "San Francisco, CA", "Tokyo, Japan")'
      }
    },
    required: ['location']
  }
};

/**
 * Default local handler for weather tool.
 */
export function defaultWeatherToolHandler(args) {
  const city = args.location || 'Unknown Location';
  return {
    location: city,
    temperature: '22°C (71.6°F)',
    condition: 'Sunny with scattered clouds',
    humidity: '48%',
    windSpeed: '12 km/h',
    timestamp: new Date().toISOString()
  };
}

/**
 * Creates an instantiated Gemini client wrapper.
 */
export function createGeminiClient({
  apiKey = process.env.GEMINI_API_KEY,
  defaultModel = 'gemini-3.6-flash'
} = {}) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not defined. Set it in .env or pass it to createGeminiClient.');
  }

  const ai = new GoogleGenAI({ apiKey });

  return {
    ai,
    defaultModel,

    /**
     * Count tokens for a given prompt string or content array.
     */
    async countTokens(contents, model = defaultModel) {
      return withRetry(async () => {
        const res = await ai.models.countTokens({ model, contents });
        return res.totalTokens;
      });
    },

    /**
     * Stream response tokens via an async generator.
     * Yields text chunks and returns the final usage metadata.
     */
    async *streamGenerate(prompt, {
      model = defaultModel,
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
    },

    /**
     * Generate schema-validated structured JSON.
     */
    async generateJSON(prompt, {
      schema = defaultOutputSchema,
      model = defaultModel,
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

        let parsedData = null;
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
    },

    /**
     * Execute a function/tool calling loop.
     * Detects model function requests, runs the local handler, and feeds results back.
     */
    async executeToolCall(prompt, {
      tool = weatherToolDeclaration,
      handler = defaultWeatherToolHandler,
      model = defaultModel,
      temperature = 0.7,
      systemInstruction,
      onToolExecute,
      onRetry
    } = {}) {
      return withRetry(async () => {
        const chat = ai.chats.create({
          model,
          config: {
            temperature,
            tools: [{ functionDeclarations: [tool] }],
            ...(systemInstruction ? { systemInstruction } : {})
          }
        });

        const initialTurn = await chat.sendMessage({ message: prompt });
        const calls = initialTurn.functionCalls;

        if (calls && calls.length > 0) {
          const functionCall = calls[0];
          if (typeof onToolExecute === 'function') {
            onToolExecute(functionCall.name, functionCall.args);
          }

          const toolExecutionResult = await handler(functionCall.args);

          const finalTurn = await chat.sendMessage({
            message: [{
              functionResponse: {
                name: functionCall.name,
                response: toolExecutionResult
              }
            }]
          });

          return {
            text: finalTurn.text,
            toolCall: functionCall,
            toolResult: toolExecutionResult,
            usageMetadata: finalTurn.usageMetadata
          };
        }

        // If no tool was needed, return direct text
        return {
          text: initialTurn.text,
          toolCall: null,
          toolResult: null,
          usageMetadata: initialTurn.usageMetadata
        };
      }, { onRetry });
    }
  };
}
