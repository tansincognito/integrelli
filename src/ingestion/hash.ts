import { createHash } from 'node:crypto';

/** SHA-256 hex digest. Used for document content hashes and embedding-cache keys. */
export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Hash of a value's canonical JSON form, with object keys sorted so that
 * key order changes do not invalidate a cache entry.
 */
export function stableHash(value: unknown): string {
  return sha256(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}
