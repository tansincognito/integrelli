import { embed, embedMany } from 'ai';
import type { Capability } from '@/knowledge/capability';
import { modelFor, modelsAvailable } from '@/models';
import { buildCapabilityDocument, capabilityDocumentHash } from './document';
import rawIndex from '@/generated/capability-embeddings.json';

/**
 * Capability-level embedding index (architecture.md sections 7 and 11).
 *
 * Cached per capability by document hash, so editing one Stripe description
 * re-embeds one vector rather than the corpus. The model id is stored in the
 * file: a model change invalidates every entry, because vectors from two
 * different models are not comparable.
 */
export interface EmbeddingEntry {
  capability_id: string;
  /** SHA-256 of the embedded document. Mismatch means stale. */
  document_hash: string;
  embedding: number[];
}

export interface EmbeddingIndexFile {
  version: 1;
  embedding_model: string;
  /** Bumped by hand when the *document construction* changes shape. */
  model_version: string;
  dimensions: number;
  built_at: string;
  entries: EmbeddingEntry[];
}

export const EMBEDDING_INDEX_PATH = 'src/generated/capability-embeddings.json';
export const DOCUMENT_VERSION = 'capability-doc-v1';

export interface LoadedEmbeddingIndex {
  available: boolean;
  reason?: 'empty' | 'model_mismatch' | 'document_version_mismatch';
  model: string;
  byCapabilityId: Map<string, EmbeddingEntry>;
}

let cached: LoadedEmbeddingIndex | null = null;

/**
 * Loads the committed index. Never throws: a missing, empty or mismatched
 * index means retrieval runs lexically, which is degraded but correct.
 */
export function loadEmbeddingIndex(override?: EmbeddingIndexFile): LoadedEmbeddingIndex {
  if (!override && cached) return cached;

  const file = (override ?? rawIndex) as EmbeddingIndexFile;
  const expectedModel = modelFor('embedding');

  let result: LoadedEmbeddingIndex;
  if (!file.entries || file.entries.length === 0) {
    result = { available: false, reason: 'empty', model: file.embedding_model, byCapabilityId: new Map() };
  } else if (file.embedding_model !== expectedModel) {
    console.warn(
      `[integrelli] embedding index was built with ${file.embedding_model} but ${expectedModel} is configured — falling back to lexical retrieval.`
    );
    result = { available: false, reason: 'model_mismatch', model: file.embedding_model, byCapabilityId: new Map() };
  } else if (file.model_version !== DOCUMENT_VERSION) {
    result = {
      available: false,
      reason: 'document_version_mismatch',
      model: file.embedding_model,
      byCapabilityId: new Map(),
    };
  } else {
    result = {
      available: true,
      model: file.embedding_model,
      byCapabilityId: new Map(file.entries.map((entry) => [entry.capability_id, entry])),
    };
  }

  if (!override) cached = result;
  return result;
}

export function _resetEmbeddingCacheForTests(): void {
  cached = null;
}

/** Embeds one query. Throws on failure; callers degrade to lexical scoring. */
export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: modelFor('embedding'), value: text });
  return embedding;
}

export interface BuildEmbeddingResult {
  embedded: number;
  reused: number;
  removed: number;
}

/**
 * Refreshes the index for the given capabilities. Only capabilities whose
 * document hash changed (or that are missing entirely) are sent to the
 * embedding model; everything else is copied forward.
 */
export async function buildEmbeddingIndex(
  capabilities: Capability[],
  indexPath: string = EMBEDDING_INDEX_PATH
): Promise<BuildEmbeddingResult> {
  if (!modelsAvailable()) {
    throw new Error('buildEmbeddingIndex requires AI_GATEWAY_API_KEY.');
  }

  const { readFileSync, writeFileSync, mkdirSync, existsSync } = await import('node:fs');
  const path = await import('node:path');
  const absolute = path.resolve(process.cwd(), indexPath);

  const model = modelFor('embedding');
  let existing: EmbeddingIndexFile | null = null;
  if (existsSync(absolute)) {
    try {
      existing = JSON.parse(readFileSync(absolute, 'utf-8')) as EmbeddingIndexFile;
    } catch {
      existing = null;
    }
  }

  const reusable = new Map<string, EmbeddingEntry>();
  if (existing && existing.embedding_model === model && existing.model_version === DOCUMENT_VERSION) {
    for (const entry of existing.entries ?? []) reusable.set(entry.capability_id, entry);
  }

  const entries: EmbeddingEntry[] = [];
  const toEmbed: Array<{ capability: Capability; document: string; hash: string }> = [];

  for (const capability of capabilities) {
    const hash = capabilityDocumentHash(capability);
    const cachedEntry = reusable.get(capability.id);
    if (cachedEntry && cachedEntry.document_hash === hash) {
      entries.push(cachedEntry);
      continue;
    }
    toEmbed.push({ capability, document: buildCapabilityDocument(capability), hash });
  }

  let dimensions = existing?.dimensions ?? 1536;
  if (toEmbed.length > 0) {
    const { embeddings } = await embedMany({ model, values: toEmbed.map((item) => item.document) });
    dimensions = embeddings[0]?.length ?? dimensions;
    toEmbed.forEach((item, i) => {
      entries.push({ capability_id: item.capability.id, document_hash: item.hash, embedding: embeddings[i] });
    });
  }

  const file: EmbeddingIndexFile = {
    version: 1,
    embedding_model: model,
    model_version: DOCUMENT_VERSION,
    dimensions,
    built_at: new Date().toISOString(),
    entries: entries.sort((a, b) => a.capability_id.localeCompare(b.capability_id)),
  };

  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');

  return {
    embedded: toEmbed.length,
    reused: entries.length - toEmbed.length,
    removed: Math.max(0, reusable.size - (entries.length - toEmbed.length)),
  };
}
