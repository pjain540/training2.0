import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { cosineSimilarity, dotProduct, euclideanDistance } from './similarity.mjs';

/**
 * @typedef {Object} VectorRecord
 * @property {string} id - Unique chunk ID
 * @property {string} text - Chunk text
 * @property {number[]} vector - Dense embedding vector
 * @property {Object} metadata - Arbitrary metadata (source, chunkIndex, docType, etc.)
 */

/**
 * @typedef {Object} SearchResult
 * @property {string} id
 * @property {string} text
 * @property {number} score - Similarity score
 * @property {Object} metadata
 */

/**
 * Local persistent vector database with cosine similarity search and metadata filtering.
 */
export class LocalVectorStore {
  /**
   * @param {Object} [options]
   * @param {string} [options.storagePath] - Optional path to persist/load the database
   */
  constructor({ storagePath = null } = {}) {
    this.storagePath = storagePath;
    /** @type {Map<string, VectorRecord>} */
    this.records = new Map();
  }

  /**
   * Adds or updates a single record.
   *
   * @param {VectorRecord} record
   */
  addRecord(record) {
    if (!record || !record.id || !record.vector || !record.text) {
      throw new Error('Record must have id, vector, and text fields.');
    }
    this.records.set(record.id, {
      id: record.id,
      text: record.text,
      vector: record.vector,
      metadata: record.metadata || {}
    });
  }

  /**
   * Adds multiple records.
   *
   * @param {VectorRecord[]} records
   */
  addRecords(records) {
    for (const record of records) {
      this.addRecord(record);
    }
  }

  /**
   * Total number of indexed chunks.
   * @returns {number}
   */
  count() {
    return this.records.size;
  }

  /**
   * Retrieves record by ID.
   * @param {string} id
   * @returns {VectorRecord|undefined}
   */
  getRecord(id) {
    return this.records.get(id);
  }

  /**
   * Clears all records from the store.
   */
  clear() {
    this.records.clear();
  }

  /**
   * Performs vector similarity search with top-K ranking, minimum score threshold, and metadata filtering.
   *
   * @param {number[]} queryVector - Dense embedding of the user query
   * @param {Object} [options]
   * @param {number} [options.topK=4] - Max chunks to retrieve
   * @param {number} [options.minScore=-1.0] - Relevance score cutoff
   * @param {Object|Function} [options.filter] - Metadata filter (key-value match or predicate function)
   * @param {'cosine'|'dot'|'euclidean'} [options.metric='cosine']
   * @returns {SearchResult[]} Sorted list of matched chunks with similarity scores
   */
  similaritySearch(queryVector, {
    topK = 4,
    minScore = -1.0,
    filter = null,
    metric = 'cosine'
  } = {}) {
    if (!queryVector || !Array.isArray(queryVector)) {
      throw new Error('queryVector must be a valid array of numbers.');
    }

    const results = [];

    for (const record of this.records.values()) {
      // 1. Metadata filter check
      if (filter) {
        if (typeof filter === 'function') {
          if (!filter(record.metadata, record)) continue;
        } else if (typeof filter === 'object') {
          let match = true;
          for (const [key, val] of Object.entries(filter)) {
            if (record.metadata[key] !== val) {
              match = false;
              break;
            }
          }
          if (!match) continue;
        }
      }

      // 2. Similarity calculation
      let score = 0;
      if (metric === 'cosine') {
        score = cosineSimilarity(queryVector, record.vector);
      } else if (metric === 'dot') {
        score = dotProduct(queryVector, record.vector);
      } else if (metric === 'euclidean') {
        // Invert distance to score: higher is better
        const dist = euclideanDistance(queryVector, record.vector);
        score = 1 / (1 + dist);
      }

      // 3. Minimum score threshold
      if (score >= minScore) {
        results.push({
          id: record.id,
          text: record.text,
          score,
          metadata: { ...record.metadata }
        });
      }
    }

    // 4. Sort descending by score
    results.sort((a, b) => b.score - a.score);

    // 5. Top-K slice
    return results.slice(0, topK);
  }

  /**
   * Saves the vector store to disk as JSON.
   *
   * @param {string} [filePath=this.storagePath]
   */
  async save(filePath = this.storagePath) {
    if (!filePath) {
      throw new Error('Storage file path must be provided to save vector store.');
    }

    await mkdir(dirname(filePath), { recursive: true });

    const serializable = {
      version: 1,
      savedAt: new Date().toISOString(),
      count: this.records.size,
      records: Array.from(this.records.values())
    };

    await writeFile(filePath, JSON.stringify(serializable, null, 2), 'utf-8');
    this.storagePath = filePath;
  }

  /**
   * Loads the vector store from disk JSON.
   *
   * @param {string} [filePath=this.storagePath]
   * @returns {Promise<number>} Number of loaded records
   */
  async load(filePath = this.storagePath) {
    if (!filePath) {
      throw new Error('Storage file path must be provided to load vector store.');
    }

    const data = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data);

    this.records.clear();
    if (Array.isArray(parsed.records)) {
      for (const rec of parsed.records) {
        this.records.set(rec.id, rec);
      }
    }

    this.storagePath = filePath;
    return this.records.size;
  }

  /**
   * Returns summary statistics of the vector index.
   */
  getStats() {
    const sources = new Set();
    let sampleDim = 0;

    for (const record of this.records.values()) {
      if (record.metadata?.source) {
        sources.add(record.metadata.source);
      }
      if (!sampleDim && record.vector) {
        sampleDim = record.vector.length;
      }
    }

    return {
      totalRecords: this.records.size,
      dimensions: sampleDim,
      uniqueSources: Array.from(sources),
      storagePath: this.storagePath
    };
  }
}
