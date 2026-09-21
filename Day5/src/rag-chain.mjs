/**
 * Day 5 — LangChain LCEL RAG Chain
 *
 * Implements the Day-3 RAG pipeline using LangChain components:
 *   • Document loading from filesystem (plain text/markdown)
 *   • RecursiveCharacterTextSplitter for chunking (replaces hand-rolled chunker.mjs)
 *   • GeminiEmbeddings (LangChain-compatible adapter over @google/genai)
 *   • MemoryVectorStore for in-process retrieval (replaces LocalVectorStore)
 *   • LCEL chain: retriever | formatDocs | prompt | model | parser
 *
 * Day 3 comparison:
 *   Day 3  ~373 lines across 4 source files (rag-pipeline, embedder, chunker, vector-store)
 *   Day 5  ~120 lines in this single file — LangChain handles chunking, storage,
 *           retrieval, and chain assembly.  Trade-off: less control, harder to debug.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document } from '@langchain/core/documents';
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  SystemMessagePromptTemplate
} from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence, RunnablePassthrough } from '@langchain/core/runnables';

import { GeminiEmbeddings } from './embeddings.mjs';

// Load .env from Day5/ root
const __dirname = fileURLToPath(new URL('.', import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

// ─── Constants ──────────────────────────────────────────────────────────────

const FALLBACK =
  'I am sorry, but the provided documents do not contain enough information to answer that question accurately.';

const SYSTEM_PROMPT = `You are a precise technical assistant. Use ONLY the context below to answer the question.
After your answer, list the sources you used in the format: [Source: <filename>]

If the context does not contain the answer, say exactly:
"${FALLBACK}"

Context:
{context}`;

// ─── Document Loading ────────────────────────────────────────────────────────

/**
 * Load all .md and .txt files from a directory as LangChain Documents.
 * @param {string} dirPath
 * @returns {Promise<Document[]>}
 */
async function loadDocumentsFromDirectory(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const docs = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (!['.md', '.txt'].includes(ext)) continue;

    const fullPath = join(dirPath, entry.name);
    const content = await readFile(fullPath, 'utf-8');
    docs.push(new Document({
      pageContent: content,
      metadata: { source: entry.name, fullPath }
    }));
  }

  if (docs.length === 0) {
    throw new Error(`No .md or .txt files found in: ${dirPath}`);
  }

  return docs;
}

// ─── RAGChain Class ──────────────────────────────────────────────────────────

export class RAGChain {
  /**
   * @param {Object} [options]
   * @param {string} [options.apiKey]
   * @param {string} [options.model]
   * @param {string} [options.embeddingModel]
   * @param {number} [options.chunkSize]
   * @param {number} [options.chunkOverlap]
   * @param {number} [options.topK]
   */
  constructor({
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    embeddingModel = 'gemini-embedding-001',
    chunkSize = 600,
    chunkOverlap = 120,
    topK = 3
  } = {}) {
    if (!apiKey) throw new Error('RAGChain: GEMINI_API_KEY is required.');

    this.apiKey = apiKey;
    this.topK = topK;
    this._vectorStore = null;
    this._retriever = null;
    this._chain = null;

    // LangChain components
    this.embeddings = new GeminiEmbeddings({ apiKey, model: embeddingModel });

    this.llm = new ChatGoogleGenerativeAI({
      apiKey,
      model,
      temperature: 0.1
    });

    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
      separators: ['\n## ', '\n### ', '\n\n', '\n', ' ', '']
    });

    this.outputParser = new StringOutputParser();
  }

  /**
   * Ingest a directory of documents: chunk → embed → store in MemoryVectorStore.
   * @param {string} docsDir  Path to directory containing .md / .txt files
   * @param {(msg: string) => void} [onStatus]
   */
  async ingest(docsDir, onStatus = () => {}) {
    onStatus(`📂 Loading documents from: ${docsDir}`);
    const rawDocs = await loadDocumentsFromDirectory(docsDir);
    onStatus(`📄 Loaded ${rawDocs.length} document(s). Splitting into chunks…`);

    // RecursiveCharacterTextSplitter: replaces hand-rolled chunker
    const chunks = await this.splitter.splitDocuments(rawDocs);
    onStatus(`✂️  Created ${chunks.length} chunks. Embedding…`);

    // MemoryVectorStore.fromDocuments: embeds + stores in one call
    this._vectorStore = await MemoryVectorStore.fromDocuments(
      chunks,
      this.embeddings
    );
    onStatus(`✅ Ingested ${chunks.length} chunks into MemoryVectorStore.`);

    this._retriever = this._vectorStore.asRetriever({ k: this.topK });
    this._buildChain();

    return { docsLoaded: rawDocs.length, chunksIndexed: chunks.length };
  }

  /**
   * Assemble the LCEL retrieval chain using pipe composition.
   * Equivalent to: retriever | formatDocs | prompt | llm | parser
   * @private
   */
  _buildChain() {
    const prompt = ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(SYSTEM_PROMPT),
      HumanMessagePromptTemplate.fromTemplate('{question}')
    ]);

    // Format retrieved docs with source citations
    const formatDocs = (docs) => {
      this._lastRetrievedDocs = docs;
      return docs
        .map((d, i) =>
          `[Source: ${d.metadata.source}, Chunk ${i + 1}]\n${d.pageContent}`
        )
        .join('\n\n---\n\n');
    };

    // LCEL chain composition
    this._chain = RunnableSequence.from([
      {
        context: this._retriever.pipe(formatDocs),
        question: new RunnablePassthrough()
      },
      prompt,
      this.llm,
      this.outputParser
    ]);
  }

  /**
   * Query the RAG chain and return answer + sources.
   * @param {string} question
   * @returns {Promise<{ answer: string, sources: string[], contextDocs: Document[] }>}
   */
  async query(question) {
    if (!this._chain) {
      throw new Error('RAGChain: Call ingest() before query().');
    }

    this._lastRetrievedDocs = [];
    const answer = await this._chain.invoke(question);

    const sources = [
      ...new Set(this._lastRetrievedDocs.map(d => d.metadata.source))
    ];

    return { answer, sources, contextDocs: this._lastRetrievedDocs };
  }

  /**
   * Expose the retriever for use as a tool input.
   */
  getRetriever() {
    if (!this._retriever) throw new Error('RAGChain: Call ingest() first.');
    return this._retriever;
  }
}
