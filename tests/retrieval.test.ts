import { describe, expect, it } from 'vitest';
import { ALL_ENDPOINTS } from '@/knowledge';
import { scoreLexical } from '@/lib/retrieval/lexical';
import { cosineSimilarity, topK } from '@/lib/retrieval/similarity';
import {
  loadEmbeddingIndex,
  computeCorpusHash,
  _resetIndexCacheForTests,
  type StaticEmbeddingIndexFile,
} from '@/lib/retrieval/index-loader';
import { retrieveCandidates } from '@/lib/retrieval/retrieve';

function topLexical(prompt: string): string {
  const scored = scoreLexical(prompt, ALL_ENDPOINTS);
  return topK(scored, 1)[0]?.id ?? '';
}

describe('lexical scorer', () => {
  it('ranks the obviously-correct endpoint first for "send an email"', () => {
    expect(topLexical('send an email')).toBe('gmail.send_message');
  });

  it('ranks the obviously-correct endpoint first for "post to slack"', () => {
    expect(topLexical('post to slack')).toBe('slack.post_message');
  });

  it('ranks the obviously-correct endpoint first for "create a stripe payment link"', () => {
    expect(topLexical('create a stripe payment link')).toBe('stripe.create_payment_link');
  });

  it('keeps "charge a customer" within the Stripe service, even though this knowledge pack has no literal "charge" endpoint', () => {
    const scored = scoreLexical('charge a customer', ALL_ENDPOINTS);
    const top = topK(scored, 1)[0];
    const endpoint = ALL_ENDPOINTS.find((e) => e.id === top.id);
    expect(endpoint?.service).toBe('stripe');
  });

  it('scores every endpoint (no crashes, no NaNs) and is stable for an empty query', () => {
    const scored = scoreLexical('', ALL_ENDPOINTS);
    expect(scored).toHaveLength(ALL_ENDPOINTS.length);
    expect(scored.every((s) => Number.isFinite(s.score))).toBe(true);
  });
});

describe('cosine similarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 10);
  });

  it('matches a hand-computed value', () => {
    // dot = 1*4 + 2*5 + 3*6 = 32; |a| = sqrt(14); |b| = sqrt(77)
    const expected = 32 / (Math.sqrt(14) * Math.sqrt(77));
    expect(cosineSimilarity([1, 2, 3], [4, 5, 6])).toBeCloseTo(expected, 10);
  });

  it('throws on mismatched vector lengths', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow();
  });

  it('topK sorts descending and truncates', () => {
    const scored = [
      { id: 'a', score: 0.1 },
      { id: 'b', score: 0.9 },
      { id: 'c', score: 0.5 },
    ];
    expect(topK(scored, 2).map((s) => s.id)).toEqual(['b', 'c']);
  });
});

describe('embedding index fallback', () => {
  it('degrades to unavailable (never throws) when the committed index is not generated', () => {
    // The committed src/generated/embedding-index.json ships with
    // generated:false (no AI_GATEWAY_API_KEY at build time in this repo).
    _resetIndexCacheForTests();
    const loaded = loadEmbeddingIndex();
    expect(loaded.available).toBe(false);
    expect(loaded.reason).toBe('not_generated');
  });

  it('degrades to unavailable when corpusHash is stale, without throwing', () => {
    const staleFile: StaticEmbeddingIndexFile = {
      model: 'openai/text-embedding-3-small',
      dimensions: 1536,
      builtAt: new Date().toISOString(),
      corpusHash: 'not-the-real-hash',
      entries: [],
      generated: true,
    };
    const loaded = loadEmbeddingIndex(staleFile);
    expect(loaded.available).toBe(false);
    expect(loaded.reason).toBe('stale_corpus_hash');
  });

  it('is available when generated:true and corpusHash matches the current knowledge pack', () => {
    const freshFile: StaticEmbeddingIndexFile = {
      model: 'openai/text-embedding-3-small',
      dimensions: 3,
      builtAt: new Date().toISOString(),
      corpusHash: computeCorpusHash(ALL_ENDPOINTS),
      entries: ALL_ENDPOINTS.map((e) => ({ id: e.id, documentText: '', embedding: [0, 0, 0] })),
      generated: true,
    };
    const loaded = loadEmbeddingIndex(freshFile);
    expect(loaded.available).toBe(true);
    expect(loaded.entries).toHaveLength(ALL_ENDPOINTS.length);
  });

  it('computeCorpusHash changes when an endpoint doc changes', () => {
    const original = computeCorpusHash(ALL_ENDPOINTS);
    const mutated = ALL_ENDPOINTS.map((e, i) => (i === 0 ? { ...e, description: e.description + ' (edited)' } : e));
    expect(computeCorpusHash(mutated)).not.toBe(original);
  });
});

describe('retrieveCandidates (no network — falls back to lexical since no real index is committed)', () => {
  it('falls back to lexical retrieval instead of throwing', async () => {
    const { candidates, method } = await retrieveCandidates('send an email to the customer');
    expect(method).toBe('lexical');
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].spec.id).toBe('gmail.send_message');
  });

  it('force-includes every endpoint of a service named literally in the prompt', async () => {
    const { candidates } = await retrieveCandidates('draft something and then talk to the Airtable API about it');
    const airtableIds = candidates.filter((c) => c.spec.service === 'airtable').map((c) => c.spec.id);
    expect(airtableIds.sort()).toEqual(
      ['airtable.create_records', 'airtable.list_records', 'airtable.update_records'].sort()
    );
  });

  it('caps the final candidate list at 16', async () => {
    // Mention every service by name to force-include everything (24 endpoints).
    const kitchenSink =
      'elevenlabs stripe gmail slack twilio notion openai airtable do something with all of these services';
    const { candidates } = await retrieveCandidates(kitchenSink);
    expect(candidates.length).toBeLessThanOrEqual(16);
  });
});
