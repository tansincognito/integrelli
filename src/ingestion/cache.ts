import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Content-hash cache (architecture.md sections 7 and 11).
 *
 * Keyed by document source. An entry is fresh only when the content hash AND
 * the extractor signature both match — a model swap must invalidate anything
 * that model produced, otherwise the store silently mixes extraction vintages.
 *
 * A fresh entry means the pipeline does not re-parse, does not call an LLM, and
 * does not re-embed. That is the single biggest cost lever in the system.
 */
export interface IngestionCacheEntry {
  content_hash: string;
  fetched_at: string;
  /** `openapi`, `markdown-heuristic`, or `llm:<model id>`. */
  extractor_signature: string;
  capability_ids: string[];
}

export interface IngestionCacheFile {
  version: 1;
  entries: Record<string, IngestionCacheEntry>;
}

export const DEFAULT_CACHE_PATH = 'src/generated/ingestion-cache.json';

export function loadCache(cachePath: string = DEFAULT_CACHE_PATH): IngestionCacheFile {
  const absolute = path.resolve(process.cwd(), cachePath);
  if (!existsSync(absolute)) return { version: 1, entries: {} };
  try {
    const parsed = JSON.parse(readFileSync(absolute, 'utf-8')) as IngestionCacheFile;
    return parsed.version === 1 && parsed.entries ? parsed : { version: 1, entries: {} };
  } catch {
    // A corrupt cache must never block ingestion; the worst case is redoing work.
    return { version: 1, entries: {} };
  }
}

export function saveCache(cache: IngestionCacheFile, cachePath: string = DEFAULT_CACHE_PATH): void {
  const absolute = path.resolve(process.cwd(), cachePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(cache, null, 2)}\n`, 'utf-8');
}

export function isFresh(
  cache: IngestionCacheFile,
  sourceId: string,
  contentHash: string,
  extractorSignature: string
): boolean {
  const entry = cache.entries[sourceId];
  return Boolean(entry && entry.content_hash === contentHash && entry.extractor_signature === extractorSignature);
}
