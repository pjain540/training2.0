import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RAGVectorStore } from './vector-store.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class IncidentRetriever {
  constructor({
    kbPath = join(__dirname, '../../data/knowledge-base.json'),
    useRemoteEmbedding = true
  } = {}) {
    this.kbPath = kbPath;
    this.store = new RAGVectorStore({ useRemoteEmbedding });
    this.initialized = false;
  }

  async init() {
    if (!this.initialized) {
      await this.store.loadFromJSON(this.kbPath);
      this.initialized = true;
    }
    return this;
  }

  /**
   * Retrieves relevant runbook chunks and generates standard citations.
   */
  async retrieve(query, { topK = 2 } = {}) {
    await this.init();
    const hits = await this.store.search(query, { topK });

    const citations = hits.map((hit, idx) => ({
      citationId: `[REF-${idx + 1}]`,
      docId: hit.id,
      title: hit.title,
      source: hit.metadata?.source || 'Internal Operations KB',
      author: hit.metadata?.author || 'Operations Team',
      relevanceScore: parseFloat(hit.score.toFixed(3))
    }));

    const formattedContext = hits.map((hit, idx) => {
      return `### Source [REF-${idx + 1}]: ${hit.title} (${hit.id})\n` +
             `Category: ${hit.category} | Source: ${hit.metadata?.source}\n` +
             `${hit.text}`;
    }).join('\n\n');

    return {
      hits,
      citations,
      formattedContext
    };
  }
}
