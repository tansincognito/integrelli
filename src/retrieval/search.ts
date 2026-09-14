import type { Capability } from '@/knowledge/capability';
import { cosineSimilarity, type ScoredId } from '@/lib/retrieval/similarity';
import { buildCapabilityDocument } from './document';
import { embedQuery, loadEmbeddingIndex } from './embeddings';

/**
 * Semantic search over capability documents, with a keyword scorer as the
 * fallback path. Both produce the same `ScoredId[]` shape so ranking and the
 * planner never learn which one ran — only the reported `method` differs.
 */

export type RetrievalMethod = 'embedding' | 'lexical';

export interface SearchResult {
  scored: ScoredId[];
  method: RetrievalMethod;
}

export async function searchCapabilities(query: string, capabilities: Capability[]): Promise<SearchResult> {
  const index = loadEmbeddingIndex();

  if (index.available) {
    try {
      const queryEmbedding = await embedQuery(query);
      const scored: ScoredId[] = [];
      let missing = 0;

      for (const capability of capabilities) {
        const entry = index.byCapabilityId.get(capability.id);
        if (!entry) {
          missing += 1;
          scored.push({ id: capability.id, score: 0 });
          continue;
        }
        scored.push({ id: capability.id, score: cosineSimilarity(queryEmbedding, entry.embedding) });
      }

      // A capability with no vector can never be retrieved semantically. If the
      // index has drifted far from the store, lexical scoring is more honest
      // than silently hiding a third of the graph.
      if (missing > capabilities.length / 4) {
        console.warn(
          `[integrelli] ${missing}/${capabilities.length} capabilities have no embedding — using lexical retrieval instead.`
        );
      } else {
        return { scored, method: 'embedding' };
      }
    } catch (err) {
      console.warn(
        '[integrelli] embedding query failed — falling back to lexical retrieval:',
        err instanceof Error ? err.message : err
      );
    }
  }

  return { scored: scoreLexical(query, capabilities), method: 'lexical' };
}

/* --------------------------------------------------------------- lexical -- */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'is', 'are',
  'with', 'by', 'at', 'as', 'it', 'this', 'that', 'be', 'via', 'into', 'from',
  'i', 'me', 'my', 'you', 'your', 'when', 'then', 'send', 'want',
]);

/** Name and provider tokens repeat this many times, so an exact operation name outranks prose overlap. */
const NAME_WEIGHT = 3;

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function weightedTokens(capability: Capability): string[] {
  const documentTokens = tokenize(buildCapabilityDocument(capability));
  const nameTokens = tokenize(`${capability.provider_id} ${capability.name} ${capability.category}`);

  const weighted: string[] = [...documentTokens];
  for (let i = 0; i < NAME_WEIGHT; i++) weighted.push(...nameTokens);
  return weighted;
}

/**
 * TF-IDF with cosine normalisation over capability documents. Deterministic,
 * offline, and good enough that the golden-query suite passes without a
 * network — which is what makes the retrieval layer testable in CI.
 */
export function scoreLexical(query: string, capabilities: Capability[]): ScoredId[] {
  const documents = capabilities.map((capability) => ({
    id: capability.id,
    tf: termFrequency(weightedTokens(capability)),
  }));

  const total = documents.length;
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const term of document.tf.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const idf = (term: string): number => Math.log((total + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1;

  const queryTerms = new Set(tokenize(query));
  if (total === 0 || queryTerms.size === 0) {
    return documents.map((document) => ({ id: document.id, score: 0 }));
  }

  return documents.map((document) => {
    let dot = 0;
    let normSquared = 0;
    for (const [term, frequency] of document.tf) {
      const weight = frequency * idf(term);
      normSquared += weight * weight;
      if (queryTerms.has(term)) dot += weight * idf(term);
    }
    const norm = Math.sqrt(normSquared);
    return { id: document.id, score: norm === 0 ? 0 : dot / norm };
  });
}

function termFrequency(tokens: string[]): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  return frequencies;
}
