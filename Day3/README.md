# Day 3: End-to-End RAG Pipeline — Chunking, Embeddings, Vector Search & Grounding

> **Core Objective**: Build a complete Retrieval-Augmented Generation (RAG) pipeline from first principles — covering chunking strategies, Gemini embeddings, a local vector database with cosine similarity, grounded answer generation, citation attribution, and fallback handling.

---

## 📚 Table of Contents

1. [Interview Hour: RAG Deep Dive](#interview-hour-rag-deep-dive)
   - [RAG vs. Fine-Tuning](#1-rag-vs-fine-tuning)
   - [What are Embeddings?](#2-what-are-embeddings)
   - [Chunking Strategies & Trade-offs](#3-chunking-strategies--trade-offs)
   - [Vector Similarity & Cosine Similarity](#4-vector-similarity--cosine-similarity)
   - [Common RAG Failure Modes](#5-common-rag-failure-modes)
2. [Architecture & Folder Structure](#architecture--folder-structure)
3. [Quickstart & CLI Usage](#quickstart--cli-usage)
4. [Modular File Walkthrough](#modular-file-walkthrough)
5. [Automated Verification Suite](#automated-verification-suite)

---

## Interview Hour: RAG Deep Dive

### 1. RAG vs. Fine-Tuning

| Attribute | RAG (Retrieval-Augmented Generation) | Fine-Tuning |
|:--|:--|:--|
| **How it works** | Retrieves relevant external documents at query time and injects them into the prompt | Trains the model's weights on new data |
| **Knowledge updates** | ✅ Real-time: update the vector index, no model retraining needed | ❌ Slow: requires full or LoRA retraining cycle (hours to days) |
| **Cost** | Low: embedding API call + vector search + one generation call | High: GPU compute for training, plus serving costs |
| **Source citations** | ✅ Natural: you know exactly which chunks were retrieved | ❌ Hard: model bakes in knowledge opaquely, no traceable source |
| **Hallucination risk** | Lower: model is grounded in retrieved text (but still possible) | Higher: model may confabulate knowledge from training distribution |
| **Data privacy** | ✅ Documents stay in your private vector store | ❌ Training data is baked into model weights (potential leak surface) |
| **Context window** | Limited by token budget: you can only inject ~4–20 chunks | Not constrained at query time (knowledge is in weights) |
| **Best for** | Dynamic knowledge, private docs, compliance-sensitive data | Style transfer, task-specific instruction following, specialized domains |

**Key insight**: RAG is the right tool when your knowledge changes frequently (e.g., product docs, legal contracts, internal wikis) or when you need auditable citations. Fine-tune when you need to change the model's *behavior* (e.g., always respond in JSON, adopt a writing style, perform specialized reasoning).

---

### 2. What are Embeddings?

An **embedding** is a dense numerical vector representation of text that captures semantic meaning in a continuous mathematical space. Similar meanings cluster together; dissimilar meanings are far apart.

```
Text: "Database cluster replication"
         ↓ Embedding Model (e.g. gemini-embedding-001)
Vector: [0.012, -0.847, 0.331, 0.004, ..., 0.218]  ← 768 dimensions
```

**Key properties**:
- **Dimensionality**: Gemini embedding-001 produces 768-dimensional vectors (configurable). Higher dimensions = richer semantic space, but larger storage and slower search.
- **Semantic proximity**: Vectors for "Raft consensus algorithm" and "distributed leader election" will be close in vector space, even if they share no words.
- **Latent space**: The model has learned to compress the entire semantic structure of language into a geometric space where meaningful relationships are encoded as directions and distances.

**Why they power RAG**:
1. Embed all document chunks → store vectors in a database.
2. Embed the user query.
3. Find the chunks whose vectors are nearest to the query vector = the most semantically relevant chunks.

---

### 3. Chunking Strategies & Trade-offs

Chunking is one of the most impactful decisions in a RAG system. Chunk too large → you waste context tokens on irrelevant content, and retrieved chunks become unfocused. Chunk too small → you lose crucial surrounding context, answers lack coherence.

#### Strategy 1: Fixed-Size Chunking

```
"Lorem ipsum dolor sit amet..." → [Chunk A: 500 chars] [Chunk B: 500 chars] ...
                                         ↕ 100 char overlap ↕
```

- **Pros**: Simple, predictable, no parsing logic needed.
- **Cons**: Brutally ignores sentence and paragraph boundaries, can split in the middle of a sentence or key fact.
- **Best for**: Homogeneous, dense text (logs, CSVs) where structure doesn't matter.

#### Strategy 2: Recursive Character Text Splitter (Recommended Default)

Splits using a *hierarchy* of separators: `\n\n` → `\n` → `. ` → `, ` → ` `

```
First attempt: Split on paragraph breaks (\n\n)
  → If any piece is still too large, recursively split on newlines (\n)
  → If still too large, split on sentences (". ")
  → Last resort: split on spaces or hard-cut
```

- **Pros**: Respects natural language boundaries (paragraphs, then sentences, then words). Results in semantically coherent chunks.
- **Cons**: Slightly more complex, behavior depends on separator hierarchy.
- **Best for**: General-purpose prose text (documentation, articles, reports).

#### Strategy 3: Markdown Header-Aware Chunking

```markdown
# Section 1         ← Split boundary
Content here...

## Subsection        ← Split boundary  
More content...

# Section 2         ← Split boundary
```

- **Pros**: Maintains structural context (section headers travel with chunks). Each chunk knows its place in the document hierarchy.
- **Cons**: Requires structured Markdown input; uneven chunk sizes.
- **Best for**: Technical documentation, wikis, runbooks where headings provide vital context.

#### Overlap and Why It Matters

```
Chunk 1: [===========================|----]
Chunk 2:               [----==============================]
                        ↑ overlap window
```

Overlap ensures a piece of text that straddles a chunk boundary still appears in at least one complete chunk. Without overlap, facts that happen to land at a split point are retrieved with missing half-context.

**Rule of thumb**: overlap = 15–25% of chunk_size. Too little = missed context at boundaries. Too much = redundant storage and retrieval noise.

---

### 4. Vector Similarity & Cosine Similarity

Given two embedding vectors **A** and **B**:

#### Cosine Similarity (Most common for text)

```
        A · B          Σ(Aᵢ × Bᵢ)
cos θ = ─────── = ────────────────────
        ‖A‖ ‖B‖   √(ΣAᵢ²) × √(ΣBᵢ²)
```

- Range: **[-1.0, 1.0]** (text embeddings: [0, 1])
- Measures the **angle** between vectors, not magnitude → scale-invariant
- **1.0** = identical direction (semantically identical)
- **0.0** = orthogonal (completely unrelated)
- **-1.0** = opposite (rare in text embeddings)

**Why cosine over Euclidean distance?**
Euclidean distance measures the straight-line distance between two points. For text embeddings, documents of different lengths naturally have different magnitudes. Cosine similarity normalizes for this — it only cares about the *direction* of the vector, not its length.

#### Dot Product Similarity
Used when vectors are pre-normalized to unit length. Equivalent to cosine similarity for unit vectors. Slightly faster to compute (avoids normalization step).

#### In this pipeline (Day 3)

| Query Score | Interpretation |
|:--|:--|
| > 0.75 | Very high — near-exact semantic match |
| 0.60–0.75 | High — same topic, similar concepts |
| 0.45–0.60 | Moderate — related but may include noise |
| < 0.45 | Low — likely off-topic → **trigger fallback** |

---

### 5. Common RAG Failure Modes

| Failure Mode | What happens | Fix |
|:--|:--|:--|
| **Bad Chunking** | Chunks split in middle of key facts; model gets half-answers | Increase overlap; use semantic/header-aware splitting |
| **Retrieval Miss** | The right chunk exists but has low cosine score vs. query | Better embeddings; add query expansion / HyDE |
| **Context Stuffing** | Too many irrelevant chunks jammed into prompt | Tune `minScore` threshold; use max-marginal relevance (MMR) |
| **Lost in the Middle** | Model ignores chunks in the middle of a long context window | Rerank chunks; put most relevant first/last |
| **Ungrounded Generation** | Model ignores retrieved context and invents answer from training data | Lower temperature; add explicit "ONLY use context" system instruction |
| **Stale Index** | Documents updated but index not re-ingested | Implement incremental re-indexing on document change |
| **Query–Document Mismatch** | Query phrasing diverges from document language | Hypothetical Document Embeddings (HyDE), query rewriting |

---

## Architecture & Folder Structure

```
Day3/
├── ingest.mjs              ← CLI: scan docs/ → chunk → embed → save vector_store.json
├── query.mjs               ← CLI: load index → embed query → search → grounded answer
├── verify-day3.mjs         ← Automated test suite (43 unit + integration tests)
├── package.json
├── .env                    ← GEMINI_API_KEY
├── docs/                   ← Sample document corpus
│   ├── architecture_overview.md
│   ├── security_handbook.md
│   └── troubleshooting_guide.txt
├── data/
│   └── vector_store.json   ← Persisted vector index (created after ingest)
└── src/
    ├── similarity.mjs      ← Cosine, dot product, Euclidean, normalization
    ├── chunker.mjs         ← Fixed-size, recursive, markdown-aware chunkers
    ├── document-loader.mjs ← Markdown, TXT, PDF loaders + directory walker
    ├── embedder.mjs        ← Gemini embedding client (batch, retry, rate-limit)
    ├── vector-store.mjs    ← Local JSON-backed vector database (search, filter, persist)
    └── rag-pipeline.mjs    ← End-to-end orchestrator (ingest + retrieve + generate)
```

### Data Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                     INGESTION PIPELINE                           │
│                                                                  │
│  docs/*.md, *.txt, *.pdf                                         │
│       ↓ DocumentLoader                                           │
│  Raw text strings                                                │
│       ↓ Chunker (recursive / markdown-aware, 600 chars, 120 overlap)
│  [ {id, text, metadata}, ... ]  ← TextChunks                    │
│       ↓ GeminiEmbedder (gemini-embedding-001, 768 dims)          │
│  [ [float x 768], ... ]         ← Dense vectors                 │
│       ↓ LocalVectorStore                                         │
│  data/vector_store.json         ← Persisted index               │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                     QUERY PIPELINE                               │
│                                                                  │
│  User question: "How do I fix ERR_RAFT_LEADER_ELECT_FAILED?"     │
│       ↓ GeminiEmbedder                                           │
│  Query vector: [float x 768]                                     │
│       ↓ LocalVectorStore.similaritySearch (cosine, top-4)        │
│  Top chunks: [{text, score, metadata}, ...]                      │
│       ↓ Relevance Check (minScore = 0.45)                        │
│    score < threshold → FALLBACK ("I don't know")                 │
│    score ≥ threshold ↓                                           │
│  Prompt assembly: system + context chunks + question             │
│       ↓ Gemini generateContent (gemini-3.5-flash, temp=0.1)      │
│  Grounded answer with [Source: filename, Chunk: N] citations     │
└──────────────────────────────────────────────────────────────────┘
```

---

## Quickstart & CLI Usage

### 1. Install dependencies
```bash
cd Day3
npm install
```

### 2. Ingest your documents
```bash
# Ingest the default docs/ folder
node ingest.mjs

# Or point to a custom directory
node ingest.mjs /path/to/your/docs
```

### 3. Query with citations
```bash
# Single question (exits after answering)
node query.mjs "What is the availability SLA for NebulaCloud?"
node query.mjs "How do I fix ERR_RAFT_LEADER_ELECT_FAILED?"
node query.mjs "What encryption standard is used for data at rest?"

# Interactive chat REPL (type 'exit' to quit)
node query.mjs --chat
```

### 4. Run the test suite
```bash
npm test
# or
node verify-day3.mjs
```

### Example Output
```
❓ Question: How do I fix ERR_RAFT_LEADER_ELECT_FAILED?

📄 Retrieved Chunks (top similarity: 0.693, threshold: 0.45)
     [troubleshooting_guide.txt, Chunk 0] score=0.693
     [troubleshooting_guide.txt, Chunk 1] score=0.690

💡 Answer [Grounded]:
  1. Check node status: `atlas-ctl cluster status --format=json`
     [Source: troubleshooting_guide.txt, Chunk: 0]
  2. Inspect heartbeat: `atlas-ctl metrics get raft_heartbeat_ms`
     [Source: troubleshooting_guide.txt, Chunk: 1]
  ...

📌 Citations used:
   [Source: troubleshooting_guide.txt, Chunk: 0]
   [Source: troubleshooting_guide.txt, Chunk: 1]

⏱  Answered in 4.8s
```

---

## Modular File Walkthrough

### `src/similarity.mjs`
Pure math: `cosineSimilarity`, `dotProduct`, `magnitude`, `euclideanDistance`, `normalizeVector`. No dependencies. Fully unit-testable.

### `src/chunker.mjs`
- `chunkFixedSize(text, { chunkSize, chunkOverlap })` — Sliding window fixed chunks
- `chunkRecursive(text, { chunkSize, chunkOverlap, separators })` — Hierarchical separator splitting with overlap
- `chunkMarkdown(markdown, { chunkSize })` — Header-aware splitting; stores `sectionHeader` in metadata

### `src/document-loader.mjs`
- `loadFile(filePath)` — Handles `.md`, `.txt`, `.pdf` (via `pdf-parse`)
- `loadDirectory(dirPath)` — Recursive directory walker

### `src/embedder.mjs`
`GeminiEmbedder` class:
- `embedText(text)` → `number[]`
- `embedBatch(texts, { onProgress })` → `number[][]` — Batches requests (batchSize=15), exponential backoff on failure

### `src/vector-store.mjs`
`LocalVectorStore` class:
- `addRecord(record)` / `addRecords(records)` — Index chunks
- `similaritySearch(queryVector, { topK, minScore, filter, metric })` — Cosine search with metadata filtering
- `save(filePath)` / `load(filePath)` — JSON persistence
- `getStats()` — Index summary

### `src/rag-pipeline.mjs`
`RAGPipeline` class — the orchestrator:
- `ingestDirectory(dirPath)` — Full ingestion flow
- `retrieve(query)` — Embed query + similarity search + relevance check
- `query(question)` — Complete RAG: retrieve → prompt assembly → Gemini generation → citations
- `evaluateGrounding(answer, chunks)` — Citation validity checker

---

## Automated Verification Suite

`verify-day3.mjs` runs **43 tests** across 5 sections:

| Section | Tests | What's Verified |
|:--|:--|:--|
| **1. Similarity Math** | 7 | Cosine, dot product, magnitude, Euclidean, normalization formulas |
| **2. Chunker** | 9 | Fixed-size, recursive, markdown chunkers; metadata; edge cases |
| **3. Vector Store** | 10 | CRUD, similarity ranking, metadata filters, disk persistence |
| **4. Embeddings (Live)** | 7 | API call, dimensions, batch, semantic similarity ordering |
| **5. E2E Pipeline (Live)** | 10 | Ingest, query, fallback, citation, grounding evaluator |

```bash
npm test
```
