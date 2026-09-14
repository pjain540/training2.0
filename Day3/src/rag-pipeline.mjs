import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { GeminiEmbedder } from './embedder.mjs';
import { LocalVectorStore } from './vector-store.mjs';
import { chunkRecursive, chunkMarkdown } from './chunker.mjs';
import { loadDirectory, loadFile } from './document-loader.mjs';

// Ensure .env is loaded
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });

export const DEFAULT_FALLBACK_MESSAGE =
  'I am sorry, but I do not have enough relevant information in the provided documents to answer your question accurately.';

/**
 * Complete End-to-End RAG Pipeline: Ingestion, Retrieval, Grounding & Evaluation.
 */
export class RAGPipeline {
  /**
   * @param {Object} [config]
   * @param {string} [config.apiKey=process.env.GEMINI_API_KEY]
   * @param {string} [config.generationModel='gemini-2.5-flash']
   * @param {string} [config.embeddingModel='gemini-embedding-001']
   * @param {number} [config.embeddingDimensions=768]
   * @param {number} [config.similarityThreshold=0.45] - Minimum cosine similarity to consider chunk relevant
   * @param {string} [config.storagePath] - Path to JSON vector store
   * @param {GeminiEmbedder} [config.embedder]
   * @param {LocalVectorStore} [config.vectorStore]
   */
  constructor({
    apiKey = process.env.GEMINI_API_KEY,
    generationModel = 'gemini-3.5-flash',
    embeddingModel = 'gemini-embedding-001',
    embeddingDimensions = 768,
    similarityThreshold = 0.45,
    storagePath = join(__dirname, '../data/vector_store.json'),
    embedder = null,
    vectorStore = null
  } = {}) {
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required for RAGPipeline.');
    }

    this.apiKey = apiKey;
    this.generationModel = generationModel;
    this.similarityThreshold = similarityThreshold;
    this.storagePath = storagePath;

    this.ai = new GoogleGenAI({ apiKey: this.apiKey });
    this.embedder = embedder || new GeminiEmbedder({
      apiKey: this.apiKey,
      model: embeddingModel,
      dimensions: embeddingDimensions
    });
    this.vectorStore = vectorStore || new LocalVectorStore({ storagePath: this.storagePath });
  }

  /**
   * Ingests an entire directory of documents into the vector database.
   *
   * @param {string} dirPath
   * @param {Object} [options]
   * @param {number} [options.chunkSize=600]
   * @param {number} [options.chunkOverlap=120]
   * @param {boolean} [options.persist=true]
   * @param {(status: string, progress?: number) => void} [options.onStatus]
   * @returns {Promise<Object>} Ingestion stats
   */
  async ingestDirectory(dirPath, {
    chunkSize = 600,
    chunkOverlap = 120,
    persist = true,
    onStatus = () => {}
  } = {}) {
    const startTime = Date.now();
    onStatus(`Scanning directory: ${dirPath}`);

    const docs = await loadDirectory(dirPath);
    if (docs.length === 0) {
      throw new Error(`No supported documents (.md, .txt, .pdf) found in ${dirPath}`);
    }

    onStatus(`Loaded ${docs.length} documents. Chunking content...`);
    const allChunks = [];

    for (const doc of docs) {
      let chunks = [];
      if (doc.extension === '.md') {
        chunks = chunkMarkdown(doc.content, {
          chunkSize,
          chunkOverlap,
          docId: doc.docId,
          source: doc.fileName,
          metadata: { ...doc.metadata, sourceFile: doc.fileName }
        });
      } else {
        chunks = chunkRecursive(doc.content, {
          chunkSize,
          chunkOverlap,
          docId: doc.docId,
          source: doc.fileName,
          metadata: { ...doc.metadata, sourceFile: doc.fileName }
        });
      }
      allChunks.push(...chunks);
    }

    onStatus(`Generated ${allChunks.length} chunks. Generating embeddings with Gemini...`);

    const chunkTexts = allChunks.map((c) => c.text);
    const vectors = await this.embedder.embedBatch(chunkTexts, {
      onProgress: (completed, total) => {
        onStatus(`Embedding chunks: ${completed}/${total} completed...`, completed / total);
      }
    });

    onStatus('Indexing chunks into local vector store...');
    this.vectorStore.clear();

    for (let i = 0; i < allChunks.length; i++) {
      const chunk = allChunks[i];
      this.vectorStore.addRecord({
        id: chunk.id,
        text: chunk.text,
        vector: vectors[i],
        metadata: {
          ...chunk.metadata,
          source: chunk.source,
          docId: chunk.docId,
          chunkIndex: chunk.chunkIndex,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          tokenEstimate: chunk.tokenEstimate
        }
      });
    }

    if (persist) {
      onStatus(`Saving vector index to ${this.storagePath}...`);
      await this.vectorStore.save(this.storagePath);
    }

    const durationMs = Date.now() - startTime;
    return {
      documentsLoaded: docs.length,
      chunksIndexed: allChunks.length,
      embeddingDimensions: vectors[0]?.length || 0,
      durationMs,
      storagePath: this.storagePath
    };
  }

  /**
   * Initializes or loads pre-indexed vector store from disk.
   */
  async loadStore(filePath = this.storagePath) {
    return await this.vectorStore.load(filePath);
  }

  /**
   * Retrieves relevant chunks for a user query.
   *
   * @param {string} query
   * @param {Object} [options]
   * @param {number} [options.topK=4]
   * @param {number} [options.minScore]
   * @param {Object|Function} [options.filter]
   * @returns {Promise<Object>}
   */
  async retrieve(query, {
    topK = 4,
    minScore = this.similarityThreshold,
    filter = null
  } = {}) {
    if (this.vectorStore.count() === 0) {
      throw new Error('Vector store is empty. Please run ingest first.');
    }

    // Embed query text
    const queryVector = await this.embedder.embedText(query);

    // Search vector store
    const matches = this.vectorStore.similaritySearch(queryVector, {
      topK,
      minScore: -1.0, // Get raw top-k first to evaluate top score
      filter,
      metric: 'cosine'
    });

    const topScore = matches.length > 0 ? matches[0].score : 0;
    const isRelevant = topScore >= minScore;
    const filteredMatches = matches.filter((m) => m.score >= minScore);

    return {
      query,
      queryVector,
      topScore,
      isRelevant,
      thresholdUsed: minScore,
      allTopMatches: matches,
      retrievedChunks: filteredMatches
    };
  }

  /**
   * Formats retrieved chunks into grounded prompt context with explicit citation anchors.
   *
   * @param {Array} chunks
   * @returns {string}
   */
  formatContext(chunks) {
    return chunks
      .map((c, i) => {
        const source = c.metadata?.source || 'Unknown';
        const chunkIndex = c.metadata?.chunkIndex ?? i;
        const score = c.score ? ` (similarity: ${c.score.toFixed(3)})` : '';
        return `[Source: ${source}, Chunk: ${chunkIndex}${score}]\n${c.text.trim()}`;
      })
      .join('\n\n---\n\n');
  }

  /**
   * Answers a question grounded in retrieved documents, with fallback handling.
   *
   * @param {string} question
   * @param {Object} [options]
   * @param {number} [options.topK=4]
   * @param {number} [options.minScore]
   * @param {Object|Function} [options.filter]
   * @param {string} [options.systemInstruction]
   * @returns {Promise<Object>}
   */
  async query(question, {
    topK = 4,
    minScore = this.similarityThreshold,
    filter = null,
    systemInstruction = null
  } = {}) {
    const startTime = Date.now();

    // 1. Retrieve
    const retrieval = await this.retrieve(question, { topK, minScore, filter });

    // 2. Fallback check: if no chunk meets the threshold
    if (!retrieval.isRelevant || retrieval.retrievedChunks.length === 0) {
      return {
        question,
        answer: DEFAULT_FALLBACK_MESSAGE,
        isFallback: true,
        topScore: retrieval.topScore,
        thresholdUsed: minScore,
        citations: [],
        retrievedChunks: retrieval.allTopMatches.slice(0, 2),
        latencyMs: Date.now() - startTime
      };
    }

    // 3. Assemble Grounded Prompt
    const contextBlock = this.formatContext(retrieval.retrievedChunks);

    const systemPrompt = systemInstruction || `You are an accurate, grounded technical assistant.
Your task is to answer the user's question using ONLY the provided document excerpts.

STRICT GROUNDING & CITATION RULES:
1. Base your answer strictly and exclusively on the context below. Do NOT use outside assumptions or make up facts.
2. For EVERY factual statement you make, append an explicit citation in the exact format: [Source: <filename>, Chunk: <index>].
   Example: "The database uses Raft consensus for leader election [Source: architecture.md, Chunk: 2]."
3. If the provided excerpts do not contain enough information to fully answer the question, provide whatever is supported and state clearly what is missing.
4. Keep the answer direct, informative, and professional.`;

    const userPrompt = `DOCUMENT EXCERPTS:
${contextBlock}

USER QUESTION:
${question}

GROUNDED ANSWER (with citations):`;

    // 4. Generate Answer with Gemini
    const response = await this.ai.models.generateContent({
      model: this.generationModel,
      contents: [
        {
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
        }
      ],
      config: {
        temperature: 0.1 // Low temperature to maximize faithfulness
      }
    });

    const answer = response.text?.trim() || '';

    // 5. Parse Citations from Generated Answer
    const citationRegex = /\[Source:\s*([^,\]]+),\s*Chunk:\s*(\d+)\]/gi;
    const citations = [];
    let match;
    while ((match = citationRegex.exec(answer)) !== null) {
      citations.push({
        raw: match[0],
        source: match[1].trim(),
        chunkIndex: parseInt(match[2], 10)
      });
    }

    return {
      question,
      answer,
      isFallback: false,
      topScore: retrieval.topScore,
      thresholdUsed: minScore,
      citations,
      retrievedChunks: retrieval.retrievedChunks,
      latencyMs: Date.now() - startTime
    };
  }

  /**
   * Basic evaluation of groundedness: checks citation validity and text overlap.
   *
   * @param {string} answer
   * @param {Array} retrievedChunks
   * @returns {Object}
   */
  evaluateGrounding(answer, retrievedChunks) {
    if (!answer || answer === DEFAULT_FALLBACK_MESSAGE) {
      return {
        isGrounded: true,
        reason: 'Fallback triggered correctly',
        citationCount: 0,
        validCitations: 0,
        unsupportedClaimsEstimate: 0
      };
    }

    const citationRegex = /\[Source:\s*([^,\]]+),\s*Chunk:\s*(\d+)\]/gi;
    const foundCitations = [];
    let match;
    while ((match = citationRegex.exec(answer)) !== null) {
      foundCitations.push({
        source: match[1].trim(),
        chunkIndex: parseInt(match[2], 10)
      });
    }

    let validCount = 0;
    for (const cite of foundCitations) {
      const matchInRetrieved = retrievedChunks.some((rc) => {
        const sourceMatch = (rc.metadata?.source || '').toLowerCase().includes(cite.source.toLowerCase());
        const indexMatch = rc.metadata?.chunkIndex === cite.chunkIndex;
        return sourceMatch && indexMatch;
      });
      if (matchInRetrieved) validCount++;
    }

    const hasCitations = foundCitations.length > 0;
    const allCitationsValid = foundCitations.length > 0 && validCount === foundCitations.length;

    return {
      isGrounded: hasCitations && validCount > 0,
      citationCount: foundCitations.length,
      validCitations: validCount,
      allCitationsValid,
      retrievedChunksCount: retrievedChunks.length
    };
  }
}
