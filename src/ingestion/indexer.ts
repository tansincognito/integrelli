import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { KnowledgeStoreSchema, type KnowledgeStore } from '@/knowledge/store';

/**
 * Stage 7 — indexing. Persists the capability graph.
 *
 * Embeddings are *not* written here: they are a separate, independently
 * cacheable artefact keyed by capability content (see src/retrieval), so a
 * change that touches one capability does not invalidate the whole vector set.
 */
export const DEFAULT_STORE_PATH = 'src/generated/capability-store.json';

export function writeStore(store: KnowledgeStore, storePath: string = DEFAULT_STORE_PATH): void {
  const validated = KnowledgeStoreSchema.parse(store);
  const absolute = path.resolve(process.cwd(), storePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(validated, null, 2)}\n`, 'utf-8');
}

/** Reads the store from disk (as opposed to the module-level import in knowledge/store.ts). */
export function readStoreFromDisk(storePath: string = DEFAULT_STORE_PATH): KnowledgeStore | null {
  const absolute = path.resolve(process.cwd(), storePath);
  if (!existsSync(absolute)) return null;
  try {
    return KnowledgeStoreSchema.parse(JSON.parse(readFileSync(absolute, 'utf-8'))) as KnowledgeStore;
  } catch {
    return null;
  }
}

export function emptyStore(): KnowledgeStore {
  return {
    version: 1,
    built_at: new Date(0).toISOString(),
    providers: [],
    api_versions: [],
    capabilities: [],
    implementations: [],
    ingestion_issues: [],
  };
}
