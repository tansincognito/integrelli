import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CapabilitySchema } from '@/knowledge/capability';
import { loadStore } from '@/knowledge/store';
import { sha256, stableHash } from '@/ingestion/hash';
import { isFresh, type IngestionCacheFile } from '@/ingestion/cache';
import { chunkMarkdown, extractHeuristic } from '@/ingestion/parser/markdown';
import { deriveCapabilityName, parseOpenApi, snakeCase } from '@/ingestion/parser/openapi';
import { normalizeDraft } from '@/ingestion/normalizer';
import { validateDraft } from '@/ingestion/validator';
import { seedById } from '@/ingestion/sources';

function readFixture(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

const stripeSeed = seedById.get('stripe')!;
const elevenlabsSeed = seedById.get('elevenlabs')!;

describe('capability naming', () => {
  it('derives readable names from method and path, ignoring machine-generated operationIds', () => {
    expect(deriveCapabilityName('POST', '/v1/checkout/sessions')).toBe('create_checkout_session');
    expect(deriveCapabilityName('POST', '/v1/payment_links')).toBe('create_payment_link');
    expect(deriveCapabilityName('GET', '/v1/customers/{customer}')).toBe('get_customer');
    expect(deriveCapabilityName('GET', '/v1/customers')).toBe('list_customers');
    expect(deriveCapabilityName('DELETE', '/v1/customers/{customer}')).toBe('delete_customer');
  });

  it('treats a documented pin as authoritative', () => {
    expect(deriveCapabilityName('POST', '/v1/anything', { 'x-integrelli-capability': 'issueRefund' })).toBe('issue_refund');
  });

  it('handles RPC-style paths and action-verb tails', () => {
    expect(deriveCapabilityName('POST', '/chat.postMessage')).toBe('chat_post_message');
    expect(deriveCapabilityName('POST', '/gmail/v1/users/{userId}/messages/send')).toBe('send_message');
  });

  it('drops version and generic container segments when qualifying a resource', () => {
    expect(deriveCapabilityName('GET', '/gmail/v1/users/{userId}/messages')).toBe('list_messages');
    expect(snakeCase('payment_intent.succeeded')).toBe('payment_intent_succeeded');
  });
});

describe('OpenAPI ingestion (path A)', () => {
  const parsed = parseOpenApi(readFixture(stripeSeed.source.location), stripeSeed);

  it('extracts every operation deterministically, with no model involved', () => {
    const names = parsed.drafts.map((draft) => draft.name);
    expect(names).toContain('create_checkout_session');
    expect(names).toContain('create_refund');
    expect(parsed.drafts.every((draft) => draft.extractor === 'openapi')).toBe(true);
    expect(parsed.drafts.every((draft) => draft.extraction_model === undefined)).toBe(true);
  });

  it('produces the same drafts on every run', () => {
    const again = parseOpenApi(readFixture(stripeSeed.source.location), stripeSeed);
    expect(stableHash(again.drafts)).toBe(stableHash(parsed.drafts));
  });

  it('turns OpenAPI 3.1 webhooks into event capabilities with the payload as outputs', () => {
    const event = parsed.drafts.find((draft) => draft.name === 'payment_intent_succeeded');
    expect(event).toBeDefined();
    expect(event!.kind).toBe('event');
    expect(event!.protocol).toBe('webhook');
    expect(event!.parameters).toHaveLength(0);
    expect(event!.response_schema).not.toBeNull();
  });

  it('resolves $refs into inline schemas', () => {
    const draft = parsed.drafts.find((d) => d.name === 'create_checkout_session')!;
    expect(draft.response_schema?.properties?.url).toBeDefined();
    expect(JSON.stringify(draft.response_schema)).not.toContain('$ref');
  });

  it('records the auth env var name and never a credential value', () => {
    const draft = parsed.drafts.find((d) => d.name === 'create_customer')!;
    expect(draft.authentication.env_var_name).toBe('STRIPE_API_KEY');
    expect(JSON.stringify(draft)).not.toMatch(/sk_live|sk_test|Bearer [A-Za-z0-9]/);
  });

  it('detects the idempotency mechanism from the documented header', () => {
    const draft = parsed.drafts.find((d) => d.name === 'create_checkout_session')!;
    expect(draft.idempotency.supported).toBe(true);
    expect(draft.idempotency.key_location).toBe('header');
  });

  it('records the source pointer for every draft', () => {
    expect(parsed.drafts.every((draft) => draft.source_pointer.startsWith('#/'))).toBe(true);
  });
});

describe('documentation ingestion (path B)', () => {
  const content = readFixture(elevenlabsSeed.source.location);
  const chunks = chunkMarkdown(content);

  it('chunks a document into one section per capability', () => {
    expect(chunks.map((chunk) => chunk.heading)).toEqual(['Text to Speech', 'List Voices']);
    expect(chunks[0].pointer).toBe('ElevenLabs API v1 > Text to Speech');
  });

  it('extracts a structured capability without calling a model', () => {
    const extracted = extractHeuristic(chunks[0]);
    expect(extracted).not.toBeNull();
    expect(extracted!.name).toBe('text_to_speech');
    expect(extracted!.method).toBe('POST');
    expect(extracted!.path).toBe('/v1/text-to-speech/{voice_id}');
    expect(extracted!.parameters.find((p) => p.name === 'text')?.required).toBe(true);
    expect(extracted!.parameters.find((p) => p.name === 'voice_id')?.location).toBe('path');
    expect(extracted!.authentication_kind).toBe('header');
    expect(extracted!.authentication_parameter_name).toBe('xi-api-key');
  });
});

describe('ingestion validation', () => {
  const parsed = parseOpenApi(readFixture(stripeSeed.source.location), stripeSeed);
  const draft = parsed.drafts.find((d) => d.name === 'create_customer')!;

  it('passes every applicable check for an OpenAPI-derived capability', () => {
    const normalized = normalizeDraft(draft, stripeSeed);
    const validation = validateDraft(draft, normalized);
    const failedApplicable = validation.checks.filter(
      (check) => check.applicable && !check.passed && check.name !== 'openapi_cross_check'
    );
    expect(failedApplicable).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(validation.confidence).toBeGreaterThan(0.9);
  });

  it('rejects a capability whose endpoint cannot be addressed', () => {
    const broken = { ...draft, endpoint: '', method: null };
    const validation = validateDraft(broken, normalizeDraft(broken, stripeSeed));
    expect(validation.ok).toBe(false);
    expect(validation.issues.some((issue) => issue.code === 'failed_endpoint_exists')).toBe(true);
  });

  it('raises confidence when a documentation extraction is cross-checked against a spec', () => {
    const heuristicDraft = {
      ...draft,
      extractor: 'markdown-heuristic' as const,
      source_pointer: 'Docs > Create Customer',
    };
    const normalized = normalizeDraft(heuristicDraft, stripeSeed);

    const unchecked = validateDraft(heuristicDraft, normalized);
    const checked = validateDraft(heuristicDraft, normalized, {
      openApiIndex: new Set(['POST /v1/customers']),
    });

    expect(checked.confidence).toBeGreaterThan(unchecked.confidence);
  });

  it('lowers confidence when a documentation extraction contradicts the spec', () => {
    const heuristicDraft = { ...draft, extractor: 'markdown-heuristic' as const };
    const normalized = normalizeDraft(heuristicDraft, stripeSeed);
    const contradicted = validateDraft(heuristicDraft, normalized, {
      openApiIndex: new Set(['POST /v1/somewhere_else']),
    });
    const unchecked = validateDraft(heuristicDraft, normalized);

    expect(contradicted.confidence).toBeLessThan(unchecked.confidence);
  });
});

describe('content hashing and the ingestion cache', () => {
  it('hashes content stably and detects any change', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).not.toBe(sha256('abd'));
    expect(sha256('abc')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('treats an entry as fresh only when both the content and the extractor match', () => {
    const cache: IngestionCacheFile = {
      version: 1,
      entries: {
        'stripe.openapi': {
          content_hash: 'a'.repeat(64),
          fetched_at: '2026-01-01T00:00:00.000Z',
          extractor_signature: 'openapi',
          capability_ids: ['stripe.create_customer'],
        },
      },
    };

    expect(isFresh(cache, 'stripe.openapi', 'a'.repeat(64), 'openapi')).toBe(true);
    expect(isFresh(cache, 'stripe.openapi', 'b'.repeat(64), 'openapi')).toBe(false);
    expect(isFresh(cache, 'stripe.openapi', 'a'.repeat(64), 'llm:some/model')).toBe(false);
    expect(isFresh(cache, 'unknown.source', 'a'.repeat(64), 'openapi')).toBe(false);
  });
});

describe('the committed capability store', () => {
  const { store } = loadStore();

  it('contains every seeded provider', () => {
    expect(store.providers.map((provider) => provider.id).sort()).toEqual(
      ['elevenlabs', 'gmail', 'hubspot', 'slack', 'stripe'].sort()
    );
  });

  it('holds only canonical-model-valid capabilities with unique ids', () => {
    const ids = store.capabilities.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const capability of store.capabilities) {
      expect(CapabilitySchema.safeParse(capability).success).toBe(true);
    }
  });

  it('gives every capability an implementation, provenance and a verification date', () => {
    const { implementationsByCapability } = loadStore();
    for (const capability of store.capabilities) {
      expect(implementationsByCapability.get(capability.id)?.length ?? 0).toBeGreaterThan(0);
      expect(capability.source.document_source_id).not.toBe('');
      expect(capability.last_verified).not.toBe('');
      expect(capability.confidence).toBeGreaterThan(0);
    }
  });

  it('trusts machine-readable specs more than prose', () => {
    const openApiDerived = store.capabilities.filter((c) => c.source.extractor === 'openapi');
    const proseDerived = store.capabilities.filter((c) => c.source.extractor !== 'openapi');
    const lowest = Math.min(...openApiDerived.map((c) => c.confidence));
    const highest = Math.max(...proseDerived.map((c) => c.confidence));
    expect(lowest).toBeGreaterThan(highest);
  });

  it('stores credential env var names and never credential values', () => {
    const serialized = JSON.stringify(store);
    expect(serialized).toMatch(/STRIPE_API_KEY/);
    expect(serialized).not.toMatch(/sk_live_|sk_test_|xoxb-|AIza[0-9A-Za-z-_]{20}/);
  });
});
