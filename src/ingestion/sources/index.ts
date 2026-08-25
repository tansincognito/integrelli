import type { ApiVersionStatus } from '@/knowledge/api-version';
import type { CapabilityCategory, Idempotency, RateLimit } from '@/knowledge/capability';
import type { DocumentationSource } from '@/knowledge/provider';

/**
 * The provider registry — the *only* place in the pipeline that holds
 * provider-specific knowledge.
 *
 * Each entry says where the documentation lives, which API version it
 * describes, and the facts that documentation reliably fails to state in a
 * machine-readable way (provider-wide rate limits, idempotency mechanism,
 * which environment variable holds the credential).
 *
 * `credential_env_var` is a NAME. No credential value ever enters this file,
 * the ingestion pipeline, an embedding, or a prompt — see architecture.md
 * section 10.
 *
 * Day 1 seeds five providers. Stripe/Gmail/Slack are the working vertical
 * slice; ElevenLabs and HubSpot exist to prove the pipeline generalises to
 * documentation that has no OpenAPI spec.
 */
export interface ProviderSeed {
  id: string;
  name: string;
  /** API version this document describes. Recorded on every capability derived from it. */
  version: string;
  status: ApiVersionStatus;
  /** Default category for capabilities from this provider; per-capability heuristics may override. */
  category: CapabilityCategory;
  source: DocumentationSource;
  credential_env_var: string;
  /** Documented provider-wide limit. Null when the provider publishes none. */
  rate_limits: RateLimit | null;
  idempotency: Idempotency;
  /** Base URL for the documentation path, where the doc states paths but not a server. */
  base_url?: string;
  /**
   * Optional machine-readable document used only to *check* documentation-derived
   * capabilities, never to create them. Lets a provider with partial OpenAPI
   * coverage still contradict a bad prose extraction (architecture.md section 6).
   */
  cross_check_source?: DocumentationSource;
  /** Lower number = ingested first. Stripe/Gmail/Slack are the Day 1 slice. */
  priority: number;
}

export const PROVIDER_SEEDS: ProviderSeed[] = [
  {
    id: 'stripe',
    name: 'Stripe',
    version: '2024-06-20',
    status: 'stable',
    category: 'payment',
    credential_env_var: 'STRIPE_API_KEY',
    rate_limits: { requests: 100, window_seconds: 1, note: 'Documented live-mode default: 100 read/write ops per second.' },
    idempotency: { supported: true, mechanism: 'Idempotency-Key request header', key_location: 'header' },
    priority: 1,
    source: {
      id: 'stripe.openapi',
      kind: 'openapi',
      location: 'src/ingestion/sources/openapi/stripe.json',
      upstream_url: 'https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json',
      label: 'Stripe OpenAPI 3.1 (trimmed local mirror)',
    },
  },
  {
    id: 'gmail',
    name: 'Gmail',
    version: 'v1',
    status: 'stable',
    category: 'email',
    credential_env_var: 'GMAIL_ACCESS_TOKEN',
    rate_limits: { requests: 250, window_seconds: 1, note: 'Documented per-user quota, in quota units per second.' },
    idempotency: { supported: false },
    priority: 2,
    source: {
      id: 'gmail.openapi',
      kind: 'openapi',
      location: 'src/ingestion/sources/openapi/gmail.json',
      upstream_url: 'https://gmail.googleapis.com/$discovery/rest?version=v1',
      label: 'Gmail API v1 (OpenAPI rendering of the discovery document, trimmed)',
    },
  },
  {
    id: 'slack',
    name: 'Slack',
    version: '1.7.0',
    status: 'stable',
    category: 'messaging',
    credential_env_var: 'SLACK_BOT_TOKEN',
    rate_limits: { requests: 1, window_seconds: 1, note: 'chat.postMessage is Tier-special: roughly 1 message per channel per second.' },
    idempotency: { supported: false },
    priority: 3,
    source: {
      id: 'slack.openapi',
      kind: 'openapi',
      location: 'src/ingestion/sources/openapi/slack.json',
      upstream_url: 'https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json',
      label: 'Slack Web API OpenAPI (trimmed local mirror)',
    },
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    version: 'v1',
    status: 'stable',
    category: 'media',
    credential_env_var: 'ELEVENLABS_API_KEY',
    rate_limits: null,
    idempotency: { supported: false },
    base_url: 'https://api.elevenlabs.io',
    priority: 4,
    source: {
      id: 'elevenlabs.docs',
      kind: 'markdown',
      location: 'src/ingestion/sources/docs/elevenlabs.md',
      upstream_url: 'https://elevenlabs.io/docs/api-reference',
      label: 'ElevenLabs API reference (documentation prose)',
    },
    cross_check_source: {
      id: 'elevenlabs.openapi_partial',
      kind: 'openapi',
      location: 'src/ingestion/sources/openapi/elevenlabs-partial.json',
      upstream_url: 'https://api.elevenlabs.io/openapi.json',
      label: 'ElevenLabs partial OpenAPI — cross-check only, not a capability source',
    },
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    version: 'v3',
    status: 'stable',
    category: 'crm',
    credential_env_var: 'HUBSPOT_ACCESS_TOKEN',
    rate_limits: { requests: 100, window_seconds: 10, note: 'Documented default: 100 requests per 10 seconds per private app.' },
    idempotency: { supported: false },
    base_url: 'https://api.hubapi.com',
    priority: 5,
    source: {
      id: 'hubspot.docs',
      kind: 'markdown',
      location: 'src/ingestion/sources/docs/hubspot.md',
      upstream_url: 'https://developers.hubspot.com/docs/api/crm/contacts',
      label: 'HubSpot CRM contacts reference (documentation prose, no OpenAPI seeded)',
    },
  },
];

export const seedById = new Map(PROVIDER_SEEDS.map((seed) => [seed.id, seed]));

export function orderedSeeds(): ProviderSeed[] {
  return [...PROVIDER_SEEDS].sort((a, b) => a.priority - b.priority);
}
