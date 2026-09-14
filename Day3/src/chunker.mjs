/**
 * Chunking strategies for RAG:
 * - Recursive Character Text Splitter (hierarchical separators with overlap)
 * - Fixed-size chunker
 * - Markdown section-aware chunker
 */

/**
 * Approximate token count from text length (1 token ~= 4 chars in English).
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

/**
 * Represents a text chunk with complete metadata.
 * @typedef {Object} TextChunk
 * @property {string} id - Unique identifier for the chunk
 * @property {string} docId - Parent document identifier
 * @property {string} source - Document source path or name
 * @property {number} chunkIndex - Zero-based index within document
 * @property {string} text - The chunk text content
 * @property {number} charStart - Starting character position in original doc
 * @property {number} charEnd - Ending character position in original doc
 * @property {number} tokenEstimate - Approximate token count
 * @property {Object} metadata - Arbitrary metadata (headers, tags, docType)
 */

/**
 * Fixed-size chunking with sliding overlap window.
 *
 * @param {string} text
 * @param {Object} [options]
 * @param {number} [options.chunkSize=500]
 * @param {number} [options.chunkOverlap=100]
 * @param {string} [options.docId='doc']
 * @param {string} [options.source='unknown']
 * @param {Object} [options.metadata={}]
 * @returns {TextChunk[]}
 */
export function chunkFixedSize(text, {
  chunkSize = 500,
  chunkOverlap = 100,
  docId = 'doc',
  source = 'unknown',
  metadata = {}
} = {}) {
  if (!text || text.trim().length === 0) return [];
  if (chunkOverlap >= chunkSize) {
    throw new Error(`chunkOverlap (${chunkOverlap}) must be smaller than chunkSize (${chunkSize})`);
  }

  const chunks = [];
  const step = chunkSize - chunkOverlap;
  let chunkIndex = 0;

  for (let i = 0; i < text.length; i += step) {
    const end = Math.min(i + chunkSize, text.length);
    const chunkText = text.slice(i, end).trim();

    if (chunkText.length > 0) {
      chunks.push({
        id: `${docId}_chunk_${chunkIndex}`,
        docId,
        source,
        chunkIndex,
        text: chunkText,
        charStart: i,
        charEnd: end,
        tokenEstimate: estimateTokens(chunkText),
        metadata: { ...metadata }
      });
      chunkIndex++;
    }

    if (end >= text.length) break;
  }

  return chunks;
}

/**
 * Recursive Character Text Splitter.
 * Recursively splits text using a hierarchy of separators to keep semantic units
 * (paragraphs, sentences, clauses, words) intact while respecting chunkSize and chunkOverlap.
 *
 * @param {string} text - Source text
 * @param {Object} [options]
 * @param {number} [options.chunkSize=600] - Max chunk size in characters
 * @param {number} [options.chunkOverlap=120] - Overlap window in characters
 * @param {string[]} [options.separators] - Hierarchical separators
 * @param {string} [options.docId='doc']
 * @param {string} [options.source='unknown']
 * @param {Object} [options.metadata={}]
 * @returns {TextChunk[]}
 */
export function chunkRecursive(text, {
  chunkSize = 600,
  chunkOverlap = 120,
  separators = ['\n\n', '\n', '. ', '? ', '! ', '; ', ', ', ' '],
  docId = 'doc',
  source = 'unknown',
  metadata = {}
} = {}) {
  if (!text || text.trim().length === 0) return [];
  if (chunkOverlap >= chunkSize) {
    throw new Error(`chunkOverlap (${chunkOverlap}) must be smaller than chunkSize (${chunkSize})`);
  }

  // Helper: recursively split text until blocks fit within chunkSize
  function splitText(textBlock, separatorIndex) {
    if (textBlock.length <= chunkSize) {
      return [textBlock];
    }
    if (separatorIndex >= separators.length) {
      // Hard split fallback if no separator worked
      const pieces = [];
      for (let i = 0; i < textBlock.length; i += chunkSize) {
        pieces.push(textBlock.slice(i, i + chunkSize));
      }
      return pieces;
    }

    const separator = separators[separatorIndex];
    const rawSplits = textBlock.split(separator);

    const goodSplits = [];
    for (let i = 0; i < rawSplits.length; i++) {
      const piece = rawSplits[i];
      if (!piece) continue;
      // Re-attach separator if it's not a whitespace separator to preserve sentence structure
      const pieceWithSep = (i < rawSplits.length - 1 && separator !== ' ')
        ? piece + separator
        : piece;

      if (pieceWithSep.length <= chunkSize) {
        goodSplits.push(pieceWithSep);
      } else {
        const subPieces = splitText(pieceWithSep, separatorIndex + 1);
        goodSplits.push(...subPieces);
      }
    }
    return goodSplits;
  }

  const rawBlocks = splitText(text, 0);

  // Merge blocks with sliding overlap window
  const finalChunks = [];
  let currentAccumulator = [];
  let currentLength = 0;
  let chunkIndex = 0;
  let charCursor = 0;

  for (let i = 0; i < rawBlocks.length; i++) {
    const block = rawBlocks[i];
    if (currentLength + block.length > chunkSize && currentAccumulator.length > 0) {
      // Commit accumulated chunk
      const chunkStr = currentAccumulator.join('').trim();
      if (chunkStr.length > 0) {
        const startPos = text.indexOf(chunkStr, Math.max(0, charCursor - 200));
        const actualStart = startPos !== -1 ? startPos : charCursor;
        const actualEnd = actualStart + chunkStr.length;
        charCursor = actualEnd;

        finalChunks.push({
          id: `${docId}_chunk_${chunkIndex++}`,
          docId,
          source,
          chunkIndex: finalChunks.length,
          text: chunkStr,
          charStart: actualStart,
          charEnd: actualEnd,
          tokenEstimate: estimateTokens(chunkStr),
          metadata: { ...metadata }
        });
      }

      // Calculate overlap: walk backward from end of accumulator
      let overlapAccumulator = [];
      let overlapLength = 0;
      for (let j = currentAccumulator.length - 1; j >= 0; j--) {
        const candidate = currentAccumulator[j];
        if (overlapLength + candidate.length <= chunkOverlap) {
          overlapAccumulator.unshift(candidate);
          overlapLength += candidate.length;
        } else {
          break;
        }
      }
      currentAccumulator = overlapAccumulator;
      currentLength = overlapLength;
    }

    currentAccumulator.push(block);
    currentLength += block.length;
  }

  if (currentAccumulator.length > 0) {
    const chunkStr = currentAccumulator.join('').trim();
    if (chunkStr.length > 0) {
      const startPos = text.indexOf(chunkStr, Math.max(0, charCursor - 200));
      const actualStart = startPos !== -1 ? startPos : charCursor;
      const actualEnd = actualStart + chunkStr.length;

      finalChunks.push({
        id: `${docId}_chunk_${chunkIndex}`,
        docId,
        source,
        chunkIndex: finalChunks.length,
        text: chunkStr,
        charStart: actualStart,
        charEnd: actualEnd,
        tokenEstimate: estimateTokens(chunkStr),
        metadata: { ...metadata }
      });
    }
  }

  return finalChunks;
}

/**
 * Markdown section-aware chunker.
 * Splits on markdown headers (#, ##, ###) while preserving the hierarchy of section titles.
 *
 * @param {string} markdown
 * @param {Object} [options]
 * @param {number} [options.chunkSize=600]
 * @param {number} [options.chunkOverlap=100]
 * @param {string} [options.docId='doc']
 * @param {string} [options.source='unknown']
 * @param {Object} [options.metadata={}]
 * @returns {TextChunk[]}
 */
export function chunkMarkdown(markdown, {
  chunkSize = 600,
  chunkOverlap = 100,
  docId = 'doc',
  source = 'unknown',
  metadata = {}
} = {}) {
  if (!markdown || markdown.trim().length === 0) return [];

  // Match headers: # Title, ## Subtitle, etc.
  const lines = markdown.split('\n');
  const sections = [];
  let currentHeader = 'Introduction';
  let currentLines = [];

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headerMatch) {
      if (currentLines.length > 0) {
        sections.push({
          header: currentHeader,
          content: currentLines.join('\n')
        });
        currentLines = [];
      }
      currentHeader = headerMatch[2].trim();
    }
    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    sections.push({
      header: currentHeader,
      content: currentLines.join('\n')
    });
  }

  const allChunks = [];
  let globalChunkIndex = 0;

  for (const section of sections) {
    const sectionChunks = chunkRecursive(section.content, {
      chunkSize,
      chunkOverlap,
      docId,
      source,
      metadata: {
        ...metadata,
        sectionHeader: section.header
      }
    });

    for (const chunk of sectionChunks) {
      chunk.id = `${docId}_chunk_${globalChunkIndex}`;
      chunk.chunkIndex = globalChunkIndex++;
      allChunks.push(chunk);
    }
  }

  return allChunks;
}
