/**
 * Vector similarity and distance mathematics for embeddings.
 */

/**
 * Calculates the dot product of two vectors: sum(A[i] * B[i]).
 *
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number}
 */
export function dotProduct(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    throw new Error(
      `Vector dimension mismatch: vecA has ${vecA?.length} dimensions, vecB has ${vecB?.length}`
    );
  }
  let sum = 0;
  for (let i = 0; i < vecA.length; i++) {
    sum += vecA[i] * vecB[i];
  }
  return sum;
}

/**
 * Calculates the L2 Euclidean norm (magnitude) of a vector: sqrt(sum(A[i]^2)).
 *
 * @param {number[]} vec
 * @returns {number}
 */
export function magnitude(vec) {
  if (!vec || vec.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i];
  }
  return Math.sqrt(sumSq);
}

/**
 * Calculates the Cosine Similarity between two vectors:
 * cos(theta) = (A . B) / (||A|| * ||B||)
 * Range: [-1, 1]. In text embeddings, typically [0, 1].
 *
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number} Cosine similarity score
 */
export function cosineSimilarity(vecA, vecB) {
  const magA = magnitude(vecA);
  const magB = magnitude(vecB);
  if (magA === 0 || magB === 0) {
    return 0; // Avoid division by zero for null vectors
  }
  const dot = dotProduct(vecA, vecB);
  const sim = dot / (magA * magB);
  // Clamp between -1.0 and 1.0 to handle floating point edge cases
  return Math.max(-1.0, Math.min(1.0, sim));
}

/**
 * Calculates the L2 Euclidean distance between two vectors:
 * sqrt(sum((A[i] - B[i])^2))
 *
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number}
 */
export function euclideanDistance(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    throw new Error(
      `Vector dimension mismatch: vecA has ${vecA?.length} dimensions, vecB has ${vecB?.length}`
    );
  }
  let sumSq = 0;
  for (let i = 0; i < vecA.length; i++) {
    const diff = vecA[i] - vecB[i];
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq);
}

/**
 * Normalizes a vector to unit length (L2 norm = 1.0).
 *
 * @param {number[]} vec
 * @returns {number[]}
 */
export function normalizeVector(vec) {
  const mag = magnitude(vec);
  if (mag === 0) return vec.slice();
  return vec.map((val) => val / mag);
}
