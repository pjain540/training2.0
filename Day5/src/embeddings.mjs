/**
 * Day 5 — LangChain Gemini Embeddings Adapter
 *
 * Wraps the @google/genai SDK's embedContent API into LangChain's Embeddings
 * interface so it can be used with MemoryVectorStore and other LangChain
 * components. This is needed because @langchain/google-genai's built-in
 * embeddings class targets the older @google/generative-ai SDK.
 */
import { GoogleGenAI } from '@google/genai';
import { Embeddings } from '@langchain/core/embeddings';

export class GeminiEmbeddings extends Embeddings {
  /**
   * @param {Object} [fields]
   * @param {string} [fields.apiKey]
   * @param {string} [fields.model]
   * @param {number} [fields.batchSize]
   */
  constructor(fields = {}) {
    super(fields);
    this.apiKey = fields.apiKey ?? process.env.GEMINI_API_KEY;
    this.model = fields.model ?? 'gemini-embedding-001';
    this.batchSize = fields.batchSize ?? 10;

    if (!this.apiKey) {
      throw new Error('GeminiEmbeddings: GEMINI_API_KEY is required.');
    }
    this.ai = new GoogleGenAI({ apiKey: this.apiKey });
  }

  /**
   * Embed a list of documents (required by LangChain Embeddings interface).
   * @param {string[]} texts
   * @returns {Promise<number[][]>}
   */
  async embedDocuments(texts) {
    const results = [];
    // Process in batches to avoid rate limits
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const batchResults = await Promise.all(
        batch.map(text => this._embedSingle(text))
      );
      results.push(...batchResults);
    }
    return results;
  }

  /**
   * Embed a single query (required by LangChain Embeddings interface).
   * @param {string} text
   * @returns {Promise<number[]>}
   */
  async embedQuery(text) {
    return this._embedSingle(text);
  }

  /**
   * Internal: Call the Gemini embedding API for one text with retry.
   * @param {string} text
   * @param {number} [retries=3]
   * @returns {Promise<number[]>}
   */
  async _embedSingle(text, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await this.ai.models.embedContent({
          model: this.model,
          contents: text.trim()
        });
        const values = res.embeddings?.[0]?.values;
        if (!values || values.length === 0) {
          throw new Error('Empty embedding response from Gemini API.');
        }
        return values;
      } catch (err) {
        const isLastAttempt = attempt === retries;
        const isRetryable = err.status === 429 || err.status === 503 || err.message?.includes('overloaded');
        if (isLastAttempt || !isRetryable) throw err;
        // Exponential backoff
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }
}
