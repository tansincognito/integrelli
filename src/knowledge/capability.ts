import { z } from 'zod';
import type { SchemaField, SemanticType } from './schema';

/**
 * A capability is what the system *can do*, stated independently of how it is
 * called. `stripe.create_checkout_session` is a capability; `POST
 * /v1/checkout/sessions` is one Implementation of it. The planner only ever
 * sees capabilities — see architecture.md section 6.
 */

/** Where an input rides on the wire. Kept on the capability because required-ness depends on it. */
export type InputLocation = 'body' | 'query' | 'path' | 'header';

export interface CapabilityInput extends SchemaField {
  location: InputLocation;
}

export type CapabilityOutput = SchemaField;

/**
 * `action` capabilities are invoked by us. `event` capabilities are emitted by
 * the provider (webhooks) and can only ever be the first step of a workflow.
 */
export type CapabilityKind = 'action' | 'event';

export type CapabilityCategory =
  | 'payment'
  | 'messaging'
  | 'email'
  | 'crm'
  | 'storage'
  | 'media'
  | 'ai'
  | 'identity'
  | 'other';

/** Authentication *shape* only. Env var names, never values. See architecture.md section 10. */
export interface CapabilityAuthentication {
  kind: 'bearer' | 'header' | 'basic' | 'query' | 'oauth2' | 'none';
  /** Header or query parameter carrying the credential, when applicable. */
  parameter_name?: string;
  /** Name of the environment variable expected to hold the credential. Never the credential. */
  env_var_name?: string;
  /** OAuth2 scopes / API-key permissions required, as documented upstream. */
  scheme_description?: string;
}

export interface RateLimit {
  requests?: number;
  window_seconds?: number;
  note?: string;
}

export interface Idempotency {
  supported: boolean;
  /** How idempotency is achieved, e.g. an `Idempotency-Key` header. */
  mechanism?: string;
  key_location?: InputLocation;
}

export type SideEffectKind = 'read' | 'create' | 'update' | 'delete' | 'send' | 'trigger';

export interface SideEffects {
  kind: SideEffectKind;
  description: string;
  /** Whether the effect can be undone by another capability of the same provider. */
  reversible: boolean;
}

export type ExtractorKind = 'openapi' | 'llm' | 'markdown-heuristic';

/** Provenance for every fact in the graph: which document, which spot, which extractor. */
export interface CapabilitySource {
  document_source_id: string;
  /** JSON pointer for OpenAPI, heading path for markdown. */
  pointer: string;
  upstream_url?: string;
  extractor: ExtractorKind;
  /** Set when the extractor is an LLM, so stale extractions can be found after a model change. */
  extraction_model?: string;
  extracted_at: string;
}

export interface Capability {
  id: string;
  provider_id: string;
  api_version_id: string;
  kind: CapabilityKind;
  name: string;
  description: string;
  category: CapabilityCategory;
  inputs: CapabilityInput[];
  outputs: CapabilityOutput[];
  authentication: CapabilityAuthentication;
  /** OAuth scopes or documented permissions required to call this. */
  permissions: string[];
  rate_limits: RateLimit | null;
  idempotency: Idempotency;
  side_effects: SideEffects;
  source: CapabilitySource;
  /** 0..1. How much we trust this record — NOT how relevant it is to a query. */
  confidence: number;
  last_verified: string;
}

const SemanticTypeSchema: z.ZodType<SemanticType> = z.enum([
  'email', 'url', 'phone', 'currency_amount', 'currency_code',
  'identifier', 'timestamp', 'boolean_flag', 'html', 'text', 'json',
]);

const JsonTypeSchema = z.enum(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

const SchemaFieldSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  type: JsonTypeSchema,
  required: z.boolean(),
  description: z.string().optional(),
  format: z.string().optional(),
  enum: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  semantic_type: SemanticTypeSchema,
});

export const CapabilitySchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]+$/),
  provider_id: z.string().min(1),
  api_version_id: z.string().min(1),
  kind: z.enum(['action', 'event']),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(['payment', 'messaging', 'email', 'crm', 'storage', 'media', 'ai', 'identity', 'other']),
  inputs: z.array(SchemaFieldSchema.extend({ location: z.enum(['body', 'query', 'path', 'header']) })),
  outputs: z.array(SchemaFieldSchema),
  authentication: z.object({
    kind: z.enum(['bearer', 'header', 'basic', 'query', 'oauth2', 'none']),
    parameter_name: z.string().optional(),
    env_var_name: z.string().optional(),
    scheme_description: z.string().optional(),
  }),
  permissions: z.array(z.string()),
  rate_limits: z
    .object({ requests: z.number().optional(), window_seconds: z.number().optional(), note: z.string().optional() })
    .nullable(),
  idempotency: z.object({
    supported: z.boolean(),
    mechanism: z.string().optional(),
    key_location: z.enum(['body', 'query', 'path', 'header']).optional(),
  }),
  side_effects: z.object({
    kind: z.enum(['read', 'create', 'update', 'delete', 'send', 'trigger']),
    description: z.string(),
    reversible: z.boolean(),
  }),
  source: z.object({
    document_source_id: z.string().min(1),
    pointer: z.string(),
    upstream_url: z.string().optional(),
    extractor: z.enum(['openapi', 'llm', 'markdown-heuristic']),
    extraction_model: z.string().optional(),
    extracted_at: z.string().min(1),
  }),
  confidence: z.number().min(0).max(1),
  last_verified: z.string().min(1),
});

/** Stable capability id: `<provider>.<snake_case_name>`. */
export function capabilityId(providerId: string, name: string): string {
  const slug = name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${providerId}.${slug}`;
}
