import { loadStore } from '@/knowledge/store';
import { rankCandidates, withProviderFloor, type RetrievedCapability } from './ranking';
import { searchCapabilities, type RetrievalMethod } from './search';

export type { RetrievedCapability } from './ranking';
export type { RetrievalMethod } from './search';

/**
 * The retrieval pipeline:
 *
 *   query → semantic search (lexical fallback) → rank → provider floor → top N
 *
 * The planner receives these candidates and nothing else. It never sees the
 * full registry, which is what keeps the prompt small enough to stay accurate
 * as the graph grows (architecture.md section 7).
 */
export interface RetrieveOptions {
  topN?: number;
  /** Provider ids named in the request; guarantees those providers are represented. */
  providerHints?: string[];
  /** Restrict to one capability kind, e.g. only events when resolving a trigger clause. */
  kind?: 'action' | 'event';
}

export interface RetrieveResult {
  candidates: RetrievedCapability[];
  method: RetrievalMethod;
  /** How many capabilities were in scope before ranking. */
  corpus_size: number;
}

const DEFAULT_TOP_N = 8;

export async function retrieveCapabilities(query: string, options: RetrieveOptions = {}): Promise<RetrieveResult> {
  const { capabilitiesById, store } = loadStore();
  const scope = options.kind
    ? store.capabilities.filter((capability) => capability.kind === options.kind)
    : store.capabilities;

  if (scope.length === 0) {
    return { candidates: [], method: 'lexical', corpus_size: 0 };
  }

  const { scored, method } = await searchCapabilities(query, scope);
  const providerHints = options.providerHints ?? [];

  const ranked = rankCandidates(scored, { capabilitiesById, providerHints, method });
  const candidates = withProviderFloor(ranked, options.topN ?? DEFAULT_TOP_N, providerHints);

  return { candidates, method, corpus_size: scope.length };
}
