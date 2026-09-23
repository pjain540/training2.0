import { readFile } from 'node:fs/promises';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cosineSimilarity } from './similarity.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

/**
 * Deterministic local semantic vector generator for fast/offline testability
 */
function localEmbed(text, dim = 64) {
  const vec = new Array(dim).fill(0);
  const words = (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let hash = 0;
    for (let c = 0; c < word.length; c++) {
      hash = (hash * 31 + word.charCodeAt(c)) | 0;
    }
    const idx = Math.abs(hash) % dim;
    vec[idx] += 1.0;
  }
  return vec;
}

export class RAGVectorStore {
  constructor({ apiKey = process.env.GEMINI_API_KEY, useRemoteEmbedding = true } = {}) {
    this.apiKey = apiKey;
    this.useRemoteEmbedding = useRemoteEmbedding && !!this.apiKey;
    this.ai = this.useRemoteEmbedding ? new GoogleGenAI({ apiKey: this.apiKey }) : null;
    this.records = [];
  }

  async embedText(text) {
    if (this.useRemoteEmbedding && this.ai) {
      try {
        const res = await this.ai.models.embedContent({
          model: 'gemini-embedding-001',
          contents: [text],
          config: { outputDimensionality: 128 }
        });
        if (res?.embeddings?.[0]?.values) {
          return res.embeddings[0].values;
        }
      } catch (err) {
        // Fallback to local embedding gracefully if API call fails
      }
    }
    return localEmbed(text, 128);
  }

  async loadFromJSON(jsonFilePath) {
    const raw = await readFile(jsonFilePath, 'utf-8');
    const docs = JSON.parse(raw);
    for (const doc of docs) {
      const vector = await this.embedText(`${doc.title} ${doc.text}`);
      this.records.push({
        id: doc.id,
        title: doc.title,
        text: doc.text,
        category: doc.category,
        metadata: doc.metadata || {},
        vector
      });
    }
    return this.records.length;
  }

  async search(query, { topK = 2, minScore = 0.05 } = {}) {
    if (!query || typeof query !== 'string') return [];
    const queryVector = await this.embedText(query);

    const scored = this.records.map(record => {
      const score = cosineSimilarity(queryVector, record.vector);
      return {
        id: record.id,
        title: record.title,
        text: record.text,
        category: record.category,
        metadata: record.metadata,
        score
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.filter(r => r.score >= minScore).slice(0, topK);
  }
}
