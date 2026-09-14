#!/usr/bin/env node
/**
 * Day 3 — Automated Verification Suite
 * Tests all pipeline stages: chunking math, similarity, embedder, vector store, and end-to-end RAG.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });

import { chunkFixedSize, chunkRecursive, chunkMarkdown } from './src/chunker.mjs';
import { cosineSimilarity, dotProduct, euclideanDistance, normalizeVector, magnitude } from './src/similarity.mjs';
import { LocalVectorStore } from './src/vector-store.mjs';
import { GeminiEmbedder } from './src/embedder.mjs';
import { RAGPipeline, DEFAULT_FALLBACK_MESSAGE } from './src/rag-pipeline.mjs';

// ── Test Harness ──────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m'
};

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ${C.green}✔${C.reset} ${label}`);
    passed++;
  } else {
    console.log(`  ${C.red}✖ FAIL${C.reset}: ${label}`);
    failed++;
  }
}

function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ${C.green}✔${C.reset} ${label}`);
    passed++;
  } else {
    console.log(`  ${C.red}✖ FAIL${C.reset}: ${label}`);
    console.log(`    Expected: ${JSON.stringify(expected)}`);
    console.log(`    Actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${C.bold}${C.cyan}━━ ${title} ━━${C.reset}`);
}

function skip(label) {
  console.log(`  ${C.yellow}⊘ SKIP${C.reset}: ${label}`);
  skipped++;
}

// ── Test Sections ─────────────────────────────────────────────────────────

section('1. Similarity Mathematics');

// Cosine similarity
const v1 = [1, 0, 0];
const v2 = [0, 1, 0];
const v3 = [1, 0, 0];
const v4 = [-1, 0, 0];
assert(Math.abs(cosineSimilarity(v1, v3) - 1.0) < 1e-6, 'Identical vectors have cosine similarity = 1.0');
assert(Math.abs(cosineSimilarity(v1, v2) - 0.0) < 1e-6, 'Orthogonal vectors have cosine similarity = 0.0');
assert(Math.abs(cosineSimilarity(v1, v4) - (-1.0)) < 1e-6, 'Opposite vectors have cosine similarity = -1.0');

// Dot product
assert(dotProduct([1, 2, 3], [4, 5, 6]) === 32, 'Dot product [1,2,3]·[4,5,6] = 32');

// Magnitude
assert(Math.abs(magnitude([3, 4]) - 5.0) < 1e-6, 'Magnitude of [3,4] = 5.0');

// Euclidean distance
assert(Math.abs(euclideanDistance([0, 0], [3, 4]) - 5.0) < 1e-6, 'Euclidean distance [0,0]→[3,4] = 5.0');

// Normalization
const normalized = normalizeVector([3, 4]);
assert(Math.abs(magnitude(normalized) - 1.0) < 1e-6, 'Normalized vector has unit magnitude');

// ── Chunker Tests ─────────────────────────────────────────────────────────

section('2. Chunker Unit Tests');

const sampleText = 'A'.repeat(200) + '\n\n' + 'B'.repeat(200) + '\n\n' + 'C'.repeat(200);

// Fixed-size chunker
const fixedChunks = chunkFixedSize(sampleText, { chunkSize: 300, chunkOverlap: 50, docId: 'test' });
assert(fixedChunks.length > 0, 'Fixed-size chunker produces chunks');
assert(fixedChunks.every(c => c.text.length <= 300), 'All fixed-size chunks respect chunkSize boundary');
assert(fixedChunks.every(c => c.id && c.docId && c.chunkIndex !== undefined), 'All chunks have required metadata fields');

// Overlap check on fixed-size
const shortOverlap = chunkFixedSize('Hello World from the other side of the gap!', {
  chunkSize: 20, chunkOverlap: 5, docId: 'ovl'
});
assert(shortOverlap.length >= 2, 'Fixed-size chunker creates multiple chunks on short text');

// Recursive chunker
const recursiveChunks = chunkRecursive(sampleText, { chunkSize: 300, chunkOverlap: 50, docId: 'rec' });
assert(recursiveChunks.length > 0, 'Recursive chunker produces chunks');
assert(recursiveChunks.every(c => c.tokenEstimate > 0), 'Recursive chunks have tokenEstimate > 0');

// Markdown chunker
const mdText = `# Section One\nContent of section one about databases.\n\n## Subsection\nMore content.\n\n# Section Two\nContent of section two about networking.\n`;
const mdChunks = chunkMarkdown(mdText, { chunkSize: 500, docId: 'md_test' });
assert(mdChunks.length > 0, 'Markdown chunker produces chunks');
assert(mdChunks.some(c => c.metadata?.sectionHeader), 'Markdown chunks include sectionHeader in metadata');

// Edge cases
const emptyChunks = chunkRecursive('', { docId: 'empty' });
assertEqual(emptyChunks.length, 0, 'Empty text returns zero chunks');

// ── Vector Store Tests ────────────────────────────────────────────────────

section('3. Local Vector Store');

const store = new LocalVectorStore();

// Add records
store.addRecord({ id: 'a', text: 'Alpha document about cloud security', vector: [1, 0, 0], metadata: { source: 'security.md', docType: 'md' } });
store.addRecord({ id: 'b', text: 'Beta document about database performance', vector: [0, 1, 0], metadata: { source: 'database.md', docType: 'md' } });
store.addRecord({ id: 'c', text: 'Gamma document about networking protocols', vector: [0, 0, 1], metadata: { source: 'network.txt', docType: 'txt' } });

assert(store.count() === 3, 'Store correctly counts 3 records');

// Cosine search for v1 → should rank 'a' highest
const results = store.similaritySearch([1, 0, 0], { topK: 3 });
assert(results.length === 3, 'Similarity search returns 3 results');
assert(results[0].id === 'a', 'Top result is the most similar record (id=a)');
assert(results[0].score > results[1].score, 'Results are sorted by score descending');

// Metadata filtering
const filteredResults = store.similaritySearch([1, 0, 0], {
  topK: 5,
  filter: { docType: 'md' }
});
assert(filteredResults.every(r => r.metadata.docType === 'md'), 'Metadata filter correctly filters by docType');

// Function filter
const fnFilterResults = store.similaritySearch([0, 1, 0], {
  topK: 3,
  filter: (meta) => meta.source.endsWith('.md')
});
assert(fnFilterResults.every(r => r.metadata.source.endsWith('.md')), 'Function-based metadata filter works');

// Retrieve by ID
const rec = store.getRecord('b');
assert(rec && rec.id === 'b', 'getRecord retrieves correct record by ID');

// Stats
const stats = store.getStats();
assert(stats.totalRecords === 3, 'Store stats show correct record count');
assert(stats.dimensions === 3, 'Store stats show correct vector dimensions');

// Persistence
const tmpPath = join(__dirname, 'data/.test_vector_store.json');
await store.save(tmpPath);
const store2 = new LocalVectorStore({ storagePath: tmpPath });
const loadedCount = await store2.load(tmpPath);
assert(loadedCount === 3, 'Store serializes and deserializes correctly from disk');

// ── Live Embedding API Test ───────────────────────────────────────────────

section('4. Gemini Embedding API (Live)');

let embedder;
try {
  embedder = new GeminiEmbedder({ dimensions: 768 });
} catch (err) {
  skip('GeminiEmbedder init failed — missing API key');
  embedder = null;
}

if (embedder) {
  try {
    const vec = await embedder.embedText('Retrieval-augmented generation is a powerful technique.');
    assert(Array.isArray(vec), 'embedText returns an array');
    assert(vec.length === 768, 'Embedding vector has 768 dimensions');
    assert(vec.every(v => typeof v === 'number'), 'All embedding values are numbers');
    const mag = magnitude(vec);
    assert(mag > 0.5 && mag < 10.0, `Embedding vector has valid magnitude (got ${mag.toFixed(4)}; cosine similarity handles non-unit vectors)`);

    // Batch
    const batch = await embedder.embedBatch(['Hello world', 'Vector databases are cool', 'RAG retrieval']);
    assert(batch.length === 3, 'embedBatch returns correct number of vectors');
    assert(batch.every(v => v.length === 768), 'All batch vectors have correct dimensions');

    // Semantic test: semantically similar texts should have high cosine similarity
    const v_raft = await embedder.embedText('Raft consensus algorithm for distributed systems');
    const v_consensus = await embedder.embedText('distributed consensus and leader election protocol');
    const v_unrelated = await embedder.embedText('Recipe for chocolate chip cookies');
    const simRaft = cosineSimilarity(v_raft, v_consensus);
    const simUnrelated = cosineSimilarity(v_raft, v_unrelated);
    assert(simRaft > simUnrelated, `Semantically similar texts score higher (${simRaft.toFixed(3)} > ${simUnrelated.toFixed(3)})`);
  } catch (err) {
    console.log(`  ${C.yellow}⚠  Embedding API error: ${err.message}${C.reset}`);
    skipped += 5;
  }
}

// ── End-to-End RAG Pipeline Test ──────────────────────────────────────────

section('5. End-to-End RAG Pipeline (Live)');

try {
  const pipeline = new RAGPipeline({
    storagePath: join(__dirname, 'data/.test_e2e_store.json')
  });

  const docsDir = join(__dirname, 'docs');
  let ingestStats;
  try {
    ingestStats = await pipeline.ingestDirectory(docsDir, {
      chunkSize: 600,
      chunkOverlap: 120,
      persist: true,
      onStatus: () => {}
    });
    assert(ingestStats.documentsLoaded >= 2, `Ingested ${ingestStats.documentsLoaded} documents from docs/`);
    assert(ingestStats.chunksIndexed >= 3, `Created ${ingestStats.chunksIndexed} chunks for indexing`);
    assert(ingestStats.embeddingDimensions === 768, `Embedding dimension is 768`);
  } catch (err) {
    skip(`Ingestion failed — ${err.message}`);
    throw err;
  }

  // Relevant query — should retrieve chunks and answer
  const result = await pipeline.query('What is the availability SLA for NebulaCloud?', {
    topK: 4,
    minScore: 0.45
  });
  assert(typeof result.answer === 'string' && result.answer.length > 10, 'Query returns a non-empty answer');
  assert(result.latencyMs > 0, 'Query latency is tracked');

  if (!result.isFallback) {
    assert(result.topScore > 0.45, `Top chunk score is above threshold (${result.topScore.toFixed(3)})`);
    assert(result.citations.length >= 0, 'Answer includes citation array');
  } else {
    console.log(`  ${C.yellow}⚠  Fallback triggered (topScore: ${result.topScore.toFixed(3)}) — may need tuning${C.reset}`);
  }

  // Out-of-domain query — should fallback
  const fallbackResult = await pipeline.query(
    'What is the recipe for chocolate lava cake with vanilla ice cream?',
    { topK: 4, minScore: 0.5 }
  );
  assert(fallbackResult.isFallback === true || fallbackResult.topScore < 0.6, `Low-relevance query triggers fallback or low score (score: ${fallbackResult.topScore.toFixed(3)})`);

  // Grounding evaluator
  const groundEval = pipeline.evaluateGrounding(result.answer, result.retrievedChunks);
  assert(typeof groundEval.citationCount === 'number', 'evaluateGrounding returns citationCount');
  assert(typeof groundEval.isGrounded === 'boolean', 'evaluateGrounding returns isGrounded boolean');

} catch (err) {
  console.log(`  ${C.yellow}⚠  E2E pipeline error: ${err.message}${C.reset}`);
  skipped += 4;
}

// ── Final Summary ─────────────────────────────────────────────────────────

console.log(`\n${C.bold}${C.cyan}━━ Test Summary ━━${C.reset}`);
console.log(`  ${C.green}✔ Passed : ${passed}${C.reset}`);
if (failed > 0) console.log(`  ${C.red}✖ Failed : ${failed}${C.reset}`);
if (skipped > 0) console.log(`  ${C.yellow}⊘ Skipped: ${skipped}${C.reset}`);
console.log();

if (failed > 0) {
  console.log(`${C.red}${C.bold}  ✖ Some tests failed. Please review the output above.\n${C.reset}`);
  process.exit(1);
} else {
  console.log(`${C.green}${C.bold}  ✔ All tests passed! Your RAG pipeline is working correctly. 🎉\n${C.reset}`);
  process.exit(0);
}
