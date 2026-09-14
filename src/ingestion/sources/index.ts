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
  {
    id: 'github',
    name: 'GitHub',
    version: '2022-11-28',
    status: 'stable',
    category: 'developer_tools',
    credential_env_var: 'GITHUB_TOKEN',
    rate_limits: { requests: 5000, window_seconds: 3600, note: 'Documented default: 5,000 authenticated REST requests per hour.' },
    idempotency: { supported: false },
    priority: 6,
    source: {
      id: 'github.openapi',
      kind: 'openapi',
      location: 'src/ingestion/sources/openapi/github.json',
      upstream_url: 'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json',
      label: 'GitHub REST API (trimmed local mirror of the official OpenAPI description)',
    },
  },
  {
    id: 'twilio',
    name: 'Twilio',
    version: '1.0.0',
    status: 'stable',
    category: 'messaging',
    credential_env_var: 'TWILIO_BASIC_AUTH',
    rate_limits: { requests: 100, window_seconds: 1, note: 'Documented default account-wide API limit: 100 requests per second.' },
    idempotency: { supported: false },
    priority: 7,
    source: {
      id: 'twilio.openapi',
      kind: 'openapi',
      location: 'src/ingestion/sources/openapi/twilio.json',
      upstream_url: 'https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/json/twilio_api_v2010.json',
      label: 'Twilio Programmable Messaging (trimmed local mirror). credential_env_var must hold base64(AccountSid:AuthToken) — Basic auth here is pre-encoded, not a raw token.',
    },
  },
  {
    id: 'discord',
    name: 'Discord',
    version: '10',
    status: 'stable',
    category: 'messaging',
    credential_env_var: 'DISCORD_BOT_TOKEN',
    rate_limits: { requests: 50, window_seconds: 1, note: 'Documented global default: 50 requests per second per bot.' },
    idempotency: { supported: false },
    priority: 8,
    source: {
      id: 'discord.openapi',
      kind: 'openapi',
      location: 'src/ingestion/sources/openapi/discord.json',
      upstream_url: 'https://raw.githubusercontent.com/discord/discord-api-spec/main/specs/openapi.json',
      label: 'Discord API (trimmed local mirror). credential_env_var must hold "Bot <token>" verbatim — the header auth scheme substitutes the env var value as-is.',
    },
  },
  {
    id: 'notion',
    name: 'Notion',
    version: '2025-09-03',
    status: 'stable',
    category: 'productivity',
    credential_env_var: 'NOTION_API_KEY',
    rate_limits: { requests: 3, window_seconds: 1, note: 'Documented average: ~3 requests per second, with short bursts tolerated.' },
    idempotency: { supported: false },
    priority: 9,
    source: {
      id: 'notion.openapi',
      kind: 'openapi',
      location: 'src/ingestion/sources/openapi/notion.json',
      upstream_url: 'https://developers.notion.com/openapi.json',
      label: 'Notion API (trimmed local mirror, fetched 2026-09 — uses the current data_sources query endpoint, not the deprecated databases/query one).',
    },
  },
  {
    id: 'asana',
    name: 'Asana',
    version: '1.0',
    status: 'stable',
    category: 'productivity',
    credential_env_var: 'ASANA_ACCESS_TOKEN',
    rate_limits: { requests: 1500, window_seconds: 60, note: 'Documented default tier: 1,500 requests per minute.' },
    idempotency: { supported: false },
    priority: 10,
    source: {
      id: 'asana.docs',
      kind: 'markdown',
      location: 'src/ingestion/sources/docs/asana.md',
      upstream_url: 'https://developers.asana.com/reference/rest-api-reference',
      label: 'Asana API reference (documentation prose — upstream OpenAPI source is YAML and this pipeline only parses JSON, so this provider ingests via the markdown path instead).',
    },
  },
  {
    id: 'square',
    name: 'Square',
    version: '2026-08-19',
    status: 'stable',
    category: 'payment',
    credential_env_var: 'SQUARE_ACCESS_TOKEN',
    rate_limits: null,
    idempotency: { supported: true, mechanism: '`idempotency_key` request body field', key_location: 'body' },
    priority: 11,
    source: {
      id: 'square.openapi',
      kind: 'openapi',
      location: 'src/ingestion/sources/openapi/square.json',
      upstream_url: 'https://raw.githubusercontent.com/square/connect-api-specification/master/api.json',
      label: 'Square Connect API (trimmed local mirror)',
    },
  },
  {
    id: 'docusign',
    name: 'DocuSign',
    version: '2.1',
    status: 'stable',
    category: 'document',
    credential_env_var: 'DOCUSIGN_ACCESS_TOKEN',
    rate_limits: { requests: 1000, window_seconds: 3600, note: 'Documented default integration-key limit: 1,000 requests per hour (varies by plan).' },
    idempotency: { supported: false },
    priority: 12,
    source: {
      id: 'docusign.openapi',
      kind: 'openapi',
      location: 'src/ingestion/sources/openapi/docusign.json',
      upstream_url: 'https://raw.githubusercontent.com/docusign/eSign-OpenAPI-Specification/master/esignature.rest.swagger-v2.1.json',
      label: 'DocuSign eSignature API (trimmed local mirror, hand-converted from the upstream Swagger 2.0 document — this pipeline\'s OpenAPI parser expects 3.x request/response shapes).',
    },
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    version: '3.0',
    status: 'stable',
    category: 'marketing',
    credential_env_var: 'MAILCHIMP_BASIC_AUTH',
    rate_limits: null,
    idempotency: { supported: false },
    priority: 13,
    source: {
      id: 'mailchimp.openapi',
      kind: 'openapi',
      location: 'src/ingestion/sources/openapi/mailchimp.json',
      upstream_url: 'https://api.mailchimp.com/schema/3.0/Swagger.json',
      label: 'Mailchimp Marketing API (trimmed local mirror, hand-converted from the upstream Swagger 2.0 document). credential_env_var must hold base64("anystring:<api_key>") — Basic auth here is pre-encoded.',
    },
  },
  {
    id: 'box',
    name: 'Box',
    version: '2.0',
    status: 'stable',
    category: 'storage',
    credential_env_var: 'BOX_ACCESS_TOKEN',
    rate_limits: { requests: 1000, window_seconds: 60, note: 'Documented default: 1,000 API calls per minute per app.' },
    idempotency: { supported: false },
    priority: 14,
    source: {
      id: 'box.openapi',
      kind: 'openapi',
      location: 'src/ingestion/sources/openapi/box.json',
      upstream_url: 'https://raw.githubusercontent.com/box/box-openapi/main/openapi.json',
      label: 'Box Platform API (trimmed local mirror)',
    },
  },
  {
    id: 'pagerduty',
    name: 'PagerDuty',
    version: '2',
    status: 'stable',
    category: 'incident_management',
    credential_env_var: 'PAGERDUTY_API_KEY',
    rate_limits: { requests: 900, window_seconds: 60, note: 'Documented default REST API v2 limit: 900 requests per minute.' },
    idempotency: { supported: false },
    priority: 15,
    source: {
      id: 'pagerduty.openapi',
      kind: 'openapi',
      location: 'src/ingestion/sources/openapi/pagerduty.json',
      upstream_url: 'https://raw.githubusercontent.com/PagerDuty/api-schema/main/reference/REST/openapiv3.json',
      label: 'PagerDuty REST API v2 (trimmed local mirror). credential_env_var must hold "Token token=<key>" verbatim — the header auth scheme substitutes the env var value as-is.',
    },
  },
];

export const seedById = new Map(PROVIDER_SEEDS.map((seed) => [seed.id, seed]));

export function orderedSeeds(): ProviderSeed[] {
  return [...PROVIDER_SEEDS].sort((a, b) => a.priority - b.priority);
}
