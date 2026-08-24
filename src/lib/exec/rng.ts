/**
 * Deterministic seeding primitives. No Math.random, no Date.now, no
 * crypto.randomUUID — every value derived from these functions is a pure
 * function of its string seed.
 */

/** FNV-1a 32-bit hash. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 PRNG: seed -> generator of numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a fresh RNG from the concatenation of `parts`, joined with "|". */
export function seededRng(...parts: Array<string | number>): () => number {
  return mulberry32(hashString(parts.join('|')));
}
