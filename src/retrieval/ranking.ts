import type { Capability } from '@/knowledge/capability';
import type { ScoredId } from '@/lib/retrieval/similarity';
import type { RetrievalMethod } from './search';

/**
 * Ranking and retrieval metadata (architecture.md section 7).
 *
 * `similarity_score` and `confidence` are reported separately and never
 * collapsed into one number in the output. Similarity says "this looks like
 * what you asked for"; confidence says "we believe this record is accurate".
 * A capability can score 0.9 on the first and 0.55 on the second, and the
 * planner is entitled to know both.
 */
export interface RetrievedCapability {
  capability_id: string;
  capability: Capability;
  /** Raw scorer output, embedding cosine or lexical TF-IDF. */
  similarity_score: number;
  /** Blended ordering score. Ordering only — never a correctness claim. */
  rank_score: number;
  provider: string;
  api_version: string;
  confidence: number;
  last_verified: string;
  retrieval_method: RetrievalMethod;
  /** True when the request named this provider outright. */
  provider_mentioned: boolean;
}

const WEIGHT_SIMILARITY = 0.75;
const WEIGHT_CONFIDENCE = 0.15;
const WEIGHT_PROVIDER_MENTION = 0.1;

export interface RankOptions {
  capabilitiesById: Map<string, Capability>;
  providerHints: string[];
  method: RetrievalMethod;
}

export function rankCandidates(scored: ScoredId[], options: RankOptions): RetrievedCapability[] {
  const { capabilitiesById, providerHints, method } = options;

  const scores = scored.map((entry) => entry.score);
  const max = Math.max(...scores, 0);
  const min = Math.min(...scores, 0);
  const range = max - min;

  const ranked: RetrievedCapability[] = [];
  for (const entry of scored) {
    const capability = capabilitiesById.get(entry.id);
    if (!capability) continue;

    const normalized = range === 0 ? 0 : (entry.score - min) / range;
    const providerMentioned = providerHints.includes(capability.provider_id);

    ranked.push({
      capability_id: capability.id,
      capability,
      similarity_score: Number(entry.score.toFixed(4)),
      rank_score: Number(
        (
          WEIGHT_SIMILARITY * normalized +
          WEIGHT_CONFIDENCE * capability.confidence +
          WEIGHT_PROVIDER_MENTION * (providerMentioned ? 1 : 0)
        ).toFixed(4)
      ),
      provider: capability.provider_id,
      api_version: capability.api_version_id,
      confidence: capability.confidence,
      last_verified: capability.last_verified,
      retrieval_method: method,
      provider_mentioned: providerMentioned,
    });
  }

  return ranked.sort((a, b) => b.rank_score - a.rank_score);
}

/**
 * Guarantees that a provider the user named contributes candidates even when
 * its capabilities did not rank in the global top N. Without this, "post it to
 * Slack" can retrieve zero Slack capabilities because the phrasing matched
 * some other provider's prose more strongly.
 */
export function withProviderFloor(
  ranked: RetrievedCapability[],
  topN: number,
  providerHints: string[],
  perProviderFloor = 3
): RetrievedCapability[] {
  const selected = ranked.slice(0, topN);
  const selectedIds = new Set(selected.map((item) => item.capability_id));

  for (const provider of providerHints) {
    const already = selected.filter((item) => item.provider === provider).length;
    if (already >= perProviderFloor) continue;

    for (const candidate of ranked.filter((item) => item.provider === provider)) {
      if (selectedIds.has(candidate.capability_id)) continue;
      selected.push(candidate);
      selectedIds.add(candidate.capability_id);
      if (selected.filter((item) => item.provider === provider).length >= perProviderFloor) break;
    }
  }

  return selected.sort((a, b) => b.rank_score - a.rank_score);
}
