import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import pdfParse from 'pdf-parse';

/**
 * @typedef {Object} LoadedDocument
 * @property {string} docId - Unique identifier (e.g. filename slug)
 * @property {string} filePath - Absolute or relative file path
 * @property {string} fileName - File basename
 * @property {string} extension - File extension (.md, .txt, .pdf)
 * @property {string} content - Raw text content
 * @property {Object} metadata - File metadata (size, lastModified)
 */

/**
 * Loads and extracts text from a single file (.md, .txt, .pdf).
 *
 * @param {string} filePath
 * @returns {Promise<LoadedDocument>}
 */
export async function loadFile(filePath) {
  const fileStat = await stat(filePath);
  const ext = extname(filePath).toLowerCase();
  const fileName = basename(filePath);
  const docId = fileName.replace(/[^a-zA-Z0-9_-]/g, '_');

  let content = '';

  if (ext === '.pdf') {
    const dataBuffer = await readFile(filePath);
    const pdfData = await pdfParse(dataBuffer);
    content = pdfData.text || '';
  } else if (ext === '.md' || ext === '.txt' || ext === '.json' || ext === '.csv') {
    content = await readFile(filePath, 'utf-8');
  } else {
    throw new Error(`Unsupported document extension: ${ext} for file: ${filePath}`);
  }

  // Normalize excessive empty lines and trailing spaces
  content = content.replace(/\r\n/g, '\n').trim();

  return {
    docId,
    filePath,
    fileName,
    extension: ext,
    content,
    metadata: {
      sizeBytes: fileStat.size,
      lastModified: fileStat.mtime.toISOString(),
      docType: ext.replace('.', '')
    }
  };
}

/**
 * Recursively scans a directory and loads all supported documents.
 *
 * @param {string} dirPath
 * @param {Object} [options]
 * @param {string[]} [options.allowedExtensions=['.md', '.txt', '.pdf']]
 * @returns {Promise<LoadedDocument[]>}
 */
export async function loadDirectory(dirPath, {
  allowedExtensions = ['.md', '.txt', '.pdf']
} = {}) {
  const documents = [];

  async function walk(currentPath) {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden folders or node_modules
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (allowedExtensions.includes(ext)) {
          try {
            const doc = await loadFile(fullPath);
            documents.push(doc);
          } catch (err) {
            console.warn(`[DocumentLoader] Warning: Failed to load ${fullPath}: ${err.message}`);
          }
        }
      }
    }
  }

  await walk(dirPath);
  return documents;
}
