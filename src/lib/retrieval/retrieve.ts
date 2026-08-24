import { ALL_ENDPOINTS, byId } from '@/knowledge';
import type { RetrievedEndpoint } from '@/types/endpoint';
import { loadEmbeddingIndex } from './index-loader';
import { embedQuery } from './embed';
import { cosineSimilarity, topK, type ScoredId } from './similarity';
import { scoreLexical } from './lexical';

const DEFAULT_TOP_N = 12;
const DEFAULT_CAP = 16;

export interface RetrieveResult {
  candidates: RetrievedEndpoint[];
  method: 'embedding' | 'lexical';
}

/**
 * Retrieves candidate endpoints for a prompt (DESIGN.md section 4):
 *  1. Try the embedding index; cosine-rank all endpoints, take the top 12.
 *  2. Force-include any endpoint whose service is named literally in the
 *     prompt (label or service id), so "Stripe" in the prompt guarantees
 *     Stripe endpoints are candidates even if they didn't rank in the top 12.
 *  3. Cap the final candidate list at 16.
 *  4. If the embedding index is unavailable/stale, or the embedding call
 *     itself throws, fall back to the lexical scorer — never crash.
 */
export async function retrieveCandidates(prompt: string): Promise<RetrieveResult> {
  const { scored, method } = await scoreAllEndpoints(prompt);

  const ranked = topK(scored, scored.length);
  const selected = new Set(ranked.slice(0, DEFAULT_TOP_N).map((r) => r.id));

  const lowerPrompt = prompt.toLowerCase();
  for (const endpoint of ALL_ENDPOINTS) {
    if (selected.has(endpoint.id)) continue;
    const label = endpoint.serviceLabel.toLowerCase();
    const serviceId = endpoint.service.toLowerCase();
    if (lowerPrompt.includes(label) || lowerPrompt.includes(serviceId)) {
      selected.add(endpoint.id);
    }
  }

  const scoreById = new Map(scored.map((s) => [s.id, s.score]));
  const finalIds = [...selected]
    .sort((a, b) => (scoreById.get(b) ?? 0) - (scoreById.get(a) ?? 0))
    .slice(0, DEFAULT_CAP);

  const candidates: RetrievedEndpoint[] = finalIds
    .map((id) => byId.get(id))
    .filter((spec): spec is NonNullable<typeof spec> => Boolean(spec))
    .map((spec) => ({ spec, score: scoreById.get(spec.id) ?? 0, method }));

  return { candidates, method };
}

async function scoreAllEndpoints(prompt: string): Promise<{ scored: ScoredId[]; method: 'embedding' | 'lexical' }> {
  const index = loadEmbeddingIndex();

  if (index.available) {
    try {
      const queryEmbedding = await embedQuery(prompt);
      const scored = index.entries.map((entry) => ({
        id: entry.id,
        score: cosineSimilarity(queryEmbedding, entry.embedding),
      }));
      return { scored, method: 'embedding' };
    } catch (err) {
      console.warn(
        '[integrelli] embedding query failed — falling back to lexical retrieval:',
        err instanceof Error ? err.message : err
      );
    }
  }

  return { scored: scoreLexical(prompt, ALL_ENDPOINTS), method: 'lexical' };
}
