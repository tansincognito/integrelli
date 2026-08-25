import { describe, expect, it } from 'vitest';
import { loadStore } from '@/knowledge/store';
import { buildGraph, findFeedLinks } from '@/knowledge/graph';
import { buildCapabilityDocument, capabilityDocumentHash } from '@/retrieval/document';
import { scoreLexical } from '@/retrieval/search';
import { rankCandidates, withProviderFloor } from '@/retrieval/ranking';
import { retrieveCapabilities } from '@/retrieval';

const loaded = loadStore();
const capabilities = loaded.store.capabilities;

describe('capability embedding documents', () => {
  it('describes one capability, not one documentation page', () => {
    const capability = loaded.capabilitiesById.get('stripe.create_payment_link')!;
    const document = buildCapabilityDocument(capability);

    expect(document).toContain('Capability: stripe create payment link');
    expect(document).toContain('Outputs:');
    expect(document).not.toContain('create_customer');
  });

  it('changes its hash when the capability changes, so stale vectors are detectable', () => {
    const capability = loaded.capabilitiesById.get('stripe.create_payment_link')!;
    const before = capabilityDocumentHash(capability);
    const after = capabilityDocumentHash({ ...capability, description: 'Something else entirely.' });

    expect(before).not.toBe(after);
    expect(capabilityDocumentHash(capability)).toBe(before);
  });
});

describe('lexical retrieval', () => {
  it('is deterministic', () => {
    const first = scoreLexical('create a payment link', capabilities);
    const second = scoreLexical('create a payment link', capabilities);
    expect(first).toEqual(second);
  });

  it('scores every capability in scope', () => {
    expect(scoreLexical('anything', capabilities)).toHaveLength(capabilities.length);
  });

  it('returns all-zero scores for a query with no usable terms', () => {
    expect(scoreLexical('the a of', capabilities).every((entry) => entry.score === 0)).toBe(true);
  });
});

describe('ranking metadata', () => {
  it('reports similarity and confidence separately', () => {
    const scored = scoreLexical('create a crm contact', capabilities);
    const ranked = rankCandidates(scored, {
      capabilitiesById: loaded.capabilitiesById,
      providerHints: [],
      method: 'lexical',
    });

    const hubspot = ranked.find((item) => item.capability_id === 'hubspot.create_contact')!;
    expect(hubspot.similarity_score).toBeGreaterThan(0);
    expect(hubspot.confidence).toBe(loaded.capabilitiesById.get('hubspot.create_contact')!.confidence);
    expect(hubspot.confidence).not.toBe(hubspot.similarity_score);
    expect(hubspot.last_verified).not.toBe('');
    expect(hubspot.api_version).toBe('hubspot@v3');
  });

  it('breaks ties toward the more trustworthy record', () => {
    const scored = capabilities.map((capability) => ({ id: capability.id, score: 0.5 }));
    const ranked = rankCandidates(scored, {
      capabilitiesById: loaded.capabilitiesById,
      providerHints: [],
      method: 'lexical',
    });

    const openApiRecord = ranked.find((item) => item.confidence === 0.95)!;
    const proseRecord = ranked.find((item) => item.confidence === 0.55)!;
    expect(ranked.indexOf(openApiRecord)).toBeLessThan(ranked.indexOf(proseRecord));
  });

  it('guarantees a named provider is represented even when it ranks poorly', () => {
    const scored = capabilities.map((capability) => ({
      id: capability.id,
      score: capability.provider_id === 'slack' ? 0 : 1,
    }));
    const ranked = rankCandidates(scored, {
      capabilitiesById: loaded.capabilitiesById,
      providerHints: ['slack'],
      method: 'lexical',
    });

    const withoutFloor = ranked.slice(0, 5).filter((item) => item.provider === 'slack');
    const withFloor = withProviderFloor(ranked, 5, ['slack']).filter((item) => item.provider === 'slack');

    expect(withoutFloor.length).toBe(0);
    expect(withFloor.length).toBeGreaterThanOrEqual(3);
  });
});

describe('retrieval scoping', () => {
  it('can restrict the corpus to events', async () => {
    const result = await retrieveCapabilities('a payment succeeded', { kind: 'event' });
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((candidate) => candidate.capability.kind === 'event')).toBe(true);
    expect(result.corpus_size).toBeLessThan(capabilities.length);
  });

  it('hands the planner a bounded candidate set rather than the whole graph', async () => {
    const result = await retrieveCapabilities('send an email', { topN: 5 });
    expect(result.candidates.length).toBeLessThanOrEqual(5);
    expect(result.corpus_size).toBe(capabilities.length);
  });
});

describe('capability graph', () => {
  const graph = buildGraph(loaded);

  it('links provider → version → capability → implementation', () => {
    expect(graph.edges).toContainEqual({ from: 'stripe', to: 'stripe@2024-06-20', kind: 'has_version' });
    expect(graph.edges.some((edge) => edge.kind === 'exposes' && edge.to === 'stripe.create_payment_link')).toBe(true);
    expect(
      graph.edges.some((edge) => edge.kind === 'implemented_by' && edge.from === 'stripe.create_payment_link')
    ).toBe(true);
  });

  it('derives produce/consume links between capabilities of different providers', () => {
    const links = findFeedLinks(['stripe.payment_intent_succeeded'], 'hubspot.create_contact', loaded);
    const emailLink = links.find((link) => link.semantic_type === 'email');

    expect(emailLink).toBeDefined();
    expect(emailLink!.from_path).toBe('data.object.receipt_email');
    expect(emailLink!.to_path).toBe('properties.email');
  });

  it('never links a capability to itself', () => {
    const selfLinks = findFeedLinks(['stripe.create_customer'], 'stripe.create_customer', loaded);
    expect(selfLinks).toEqual([]);
  });
});
