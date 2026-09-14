import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Load .env automatically relative to this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });

/**
 * Gemini Embeddings Client wrapper with batching, retries, and dimension controls.
 */
export class GeminiEmbedder {
  /**
   * @param {Object} [config]
   * @param {string} [config.apiKey=process.env.GEMINI_API_KEY]
   * @param {string} [config.model='gemini-embedding-001']
   * @param {number} [config.dimensions=768]
   * @param {number} [config.batchSize=15]
   * @param {number} [config.maxRetries=3]
   */
  constructor({
    apiKey = process.env.GEMINI_API_KEY,
    model = 'gemini-embedding-001',
    dimensions = 768,
    batchSize = 15,
    maxRetries = 3
  } = {}) {
    if (!apiKey) {
      throw new Error(
        'GEMINI_API_KEY is required. Please set it in your .env file or pass it to GeminiEmbedder.'
      );
    }
    this.apiKey = apiKey;
    this.model = model;
    this.dimensions = dimensions;
    this.batchSize = batchSize;
    this.maxRetries = maxRetries;
    this.ai = new GoogleGenAI({ apiKey: this.apiKey });
  }

  /**
   * Generates embedding vector for a single text.
   *
   * @param {string} text
   * @param {Object} [options]
   * @param {string} [options.title] - Optional title for document chunks
   * @returns {Promise<number[]>} Float array of embedding vector
   */
  async embedText(text, { title } = {}) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Text to embed must be a non-empty string.');
    }

    const vectors = await this.embedBatch([text], { title });
    return vectors[0];
  }

  /**
   * Embeds a list of texts in batches with automatic retries and exponential backoff.
   *
   * @param {string[]} texts
   * @param {Object} [options]
   * @param {string} [options.title]
   * @param {(completed: number, total: number) => void} [options.onProgress]
   * @returns {Promise<number[][]>}
   */
  async embedBatch(texts, { title, onProgress } = {}) {
    if (!Array.isArray(texts) || texts.length === 0) {
      return [];
    }

    const allEmbeddings = [];
    const total = texts.length;

    for (let i = 0; i < total; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      let attempt = 0;
      let success = false;
      let lastError = null;

      while (attempt < this.maxRetries && !success) {
        try {
          attempt++;
          const res = await this.ai.models.embedContent({
            model: this.model,
            contents: batch,
            config: {
              outputDimensionality: this.dimensions,
              ...(title ? { title } : {})
            }
          });

          if (!res?.embeddings || res.embeddings.length === 0) {
            throw new Error('API returned empty embeddings response.');
          }

          for (const item of res.embeddings) {
            allEmbeddings.push(item.values);
          }
          success = true;
        } catch (err) {
          lastError = err;
          // Check for rate limits or transient errors
          const isRateLimit = err?.message?.includes('429') || err?.status === 429;
          const waitTime = isRateLimit ? attempt * 3000 : attempt * 1000;

          if (attempt < this.maxRetries) {
            console.warn(
              `[GeminiEmbedder] Batch ${i / this.batchSize + 1} attempt ${attempt} failed (${err.message}). Retrying in ${waitTime}ms...`
            );
            await new Promise((resolve) => setTimeout(resolve, waitTime));
          }
        }
      }

      if (!success) {
        throw new Error(
          `[GeminiEmbedder] Failed to embed batch after ${this.maxRetries} attempts: ${lastError?.message}`
        );
      }

      if (onProgress) {
        onProgress(Math.min(i + batch.length, total), total);
      }
    }

    return allEmbeddings;
  }
}
