import type { EndpointSpec } from '@/types/endpoint';
import type { ScoredId } from './similarity';

/**
 * Keyword fallback scorer. No network, no embeddings. Used when the static
 * embedding index is missing/stale/ungenerated, or an embedding call fails
 * at query time (DESIGN.md section 4).
 *
 * TF-IDF-ish: term frequency per endpoint document, weighted so the
 * hand-curated `keywords` field counts more than incidental word overlap in
 * descriptions/paths, times inverse document frequency across the corpus,
 * cosine-normalized by each document's own vector length so a document that
 * simply repeats a word more often doesn't win purely on repetition.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'is', 'are',
  'with', 'by', 'at', 'as', 'it', 'this', 'that', 'be', 'via', 'into', 'from',
  'i', 'me', 'my', 'you', 'your',
]);

const KEYWORD_WEIGHT = 3;

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return matches.filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Weighted token multiset for one endpoint: keyword hits count 3x. */
function weightedTokens(spec: EndpointSpec): string[] {
  const titleTokens = tokenize(`${spec.serviceLabel} ${spec.method} ${spec.path}`);
  const descriptionTokens = tokenize(spec.description);
  const keywordTokens = tokenize(spec.keywords.join(' '));
  const paramTokens = tokenize(spec.params.map((p) => `${p.name} ${p.description}`).join(' '));
  const requestFieldTokens = spec.requestSchema?.properties
    ? tokenize(
        Object.entries(spec.requestSchema.properties)
          .map(([name, fieldSchema]) => `${name} ${fieldSchema.description ?? ''}`)
          .join(' ')
      )
    : [];

  const weightedKeywordTokens: string[] = [];
  for (let i = 0; i < KEYWORD_WEIGHT; i++) weightedKeywordTokens.push(...keywordTokens);

  return [...titleTokens, ...descriptionTokens, ...weightedKeywordTokens, ...paramTokens, ...requestFieldTokens];
}

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/** Scores every endpoint against a free-text query. Higher is more relevant. */
export function scoreLexical(query: string, endpoints: EndpointSpec[]): ScoredId[] {
  const docs = endpoints.map((spec) => ({ id: spec.id, tf: termFrequency(weightedTokens(spec)) }));
  const N = docs.length;

  const documentFrequency = new Map<string, number>();
  for (const doc of docs) {
    for (const term of doc.tf.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const idf = (term: string): number => Math.log((N + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1;

  const queryTerms = [...new Set(tokenize(query))];
  if (N === 0 || queryTerms.length === 0) {
    return docs.map((doc) => ({ id: doc.id, score: 0 }));
  }

  return docs.map((doc) => {
    let dot = 0;
    let docNormSquared = 0;
    for (const [term, tf] of doc.tf) {
      const weight = tf * idf(term);
      docNormSquared += weight * weight;
      if (queryTerms.includes(term)) {
        dot += weight * idf(term);
      }
    }
    const docNorm = Math.sqrt(docNormSquared);
    const score = docNorm === 0 ? 0 : dot / docNorm;
    return { id: doc.id, score };
  });
}
