import { describe, expect, it } from 'vitest';
import { retrieveCapabilities } from '@/retrieval';
import { loadStore } from '@/knowledge/store';
import { GOLDEN_QUERIES } from './fixtures/golden-queries';

/**
 * The knowledge layer's regression suite. If ingestion changes a description, a
 * name, or a schema in a way that hurts retrieval, this is what notices.
 *
 * Runs on the lexical path — no network, no API key — so a CI failure here is
 * about the knowledge base, never about a model being unavailable.
 */
describe('golden queries', () => {
  it('covers every seeded provider', () => {
    const covered = new Set(GOLDEN_QUERIES.map((query) => query.provider));
    const seeded = new Set(loadStore().store.providers.map((provider) => provider.id));
    expect([...seeded].every((provider) => covered.has(provider))).toBe(true);
  });

  it('points every expected capability at a capability that actually exists', () => {
    const { capabilitiesById } = loadStore();
    for (const query of GOLDEN_QUERIES) {
      expect(capabilitiesById.has(query.expected_capability_id), query.expected_capability_id).toBe(true);
    }
  });

  for (const golden of GOLDEN_QUERIES) {
    it(`"${golden.query}" retrieves ${golden.expected_capability_id} within rank ${golden.max_rank}`, async () => {
      const result = await retrieveCapabilities(golden.query, { topN: 5 });
      const rank = result.candidates.findIndex((c) => c.capability_id === golden.expected_capability_id) + 1;

      expect(rank, `not retrieved in the top 5: ${result.candidates.map((c) => c.capability_id).join(', ')}`).toBeGreaterThan(0);
      expect(rank).toBeLessThanOrEqual(golden.max_rank);
    });
  }
});
