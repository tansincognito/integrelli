/** Cosine similarity between two equal-length numeric vectors. Pure, no I/O. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: vector length mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface ScoredId {
  id: string;
  score: number;
}

/** Returns the top `k` entries sorted by descending score. Does not mutate input. */
export function topK<T extends ScoredId>(scored: T[], k: number): T[] {
  return [...scored].sort((a, b) => b.score - a.score).slice(0, Math.max(0, k));
}
