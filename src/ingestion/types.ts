import { z } from 'zod';
import type { DocumentationSource } from '@/knowledge/provider';
import type {
  CapabilityAuthentication,
  CapabilityCategory,
  CapabilityKind,
  ExtractorKind,
  Idempotency,
  InputLocation,
  RateLimit,
  SideEffects,
} from '@/knowledge/capability';
import type { HttpMethod, Protocol } from '@/knowledge/implementation';
import type { JsonSchemaNode, JsonPrimitive } from '@/knowledge/schema';

/**
 * Types shared by the ingestion pipeline stages:
 *
 *   DocumentSource → Fetcher → Parser → Normalizer → Validator → Builder → Indexer
 *
 * Every stage is provider-independent. Provider-specific knowledge lives only
 * in `src/ingestion/sources/index.ts` (which documents *where* to look and
 * which env var holds that provider's credential — never the credential).
 */

/** Raw bytes plus provenance, straight out of the fetcher. */
export interface FetchedDocument {
  source: DocumentationSource;
  content: string;
  /** SHA-256 of `content`. The cache key for every downstream stage. */
  content_hash: string;
  fetched_at: string;
}

/** One parameter as stated by a document, before it becomes a canonical input. */
export interface DraftParameter {
  name: string;
  location: InputLocation;
  required: boolean;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  description?: string;
  format?: string;
  enum?: JsonPrimitive[];
}

/**
 * A parser's output: one candidate capability, still uncanonicalised. Both
 * ingestion paths (OpenAPI and documentation) produce this exact shape, which
 * is what keeps the LLM path from inventing its own vocabulary.
 */
export interface CapabilityDraft {
  provider_id: string;
  api_version: string;
  kind: CapabilityKind;
  /** Snake_case operation name without the provider prefix, e.g. `create_checkout_session`. */
  name: string;
  description: string;
  category?: CapabilityCategory;

  protocol: Protocol;
  method: HttpMethod | null;
  /** Absolute endpoint including the server base URL. */
  endpoint: string;
  path_parameters: string[];
  headers: Record<string, string>;
  request_content_type?: string;

  parameters: DraftParameter[];
  request_schema: JsonSchemaNode | null;
  response_schema: JsonSchemaNode | null;

  authentication: CapabilityAuthentication;
  permissions: string[];
  rate_limits: RateLimit | null;
  idempotency: Idempotency;
  side_effects?: SideEffects;

  /** JSON pointer (OpenAPI) or heading path (markdown). */
  source_pointer: string;
  extractor: ExtractorKind;
  extraction_model?: string;
}

/**
 * Zod mirror of the subset of `CapabilityDraft` an LLM is allowed to produce.
 * Deliberately narrower than the interface: transport details the model cannot
 * know reliably (headers, absolute endpoint assembly, protocol) are filled in
 * by the normalizer from the source registry, not by the model.
 */
export const LlmCapabilityDraftSchema = z.object({
  name: z.string().regex(/^[a-z0-9_]+$/, 'snake_case, no provider prefix'),
  description: z.string().min(10),
  kind: z.enum(['action', 'event']),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  /** Path only, e.g. `/v1/text-to-speech/{voice_id}`. */
  path: z.string().startsWith('/'),
  parameters: z.array(
    z.object({
      name: z.string().min(1),
      location: z.enum(['body', 'query', 'path', 'header']),
      required: z.boolean(),
      type: z.enum(['string', 'number', 'integer', 'boolean', 'object', 'array']),
      description: z.string().optional(),
    })
  ),
  response_fields: z.array(
    z.object({
      name: z.string().min(1),
      type: z.enum(['string', 'number', 'integer', 'boolean', 'object', 'array']),
      description: z.string().optional(),
    })
  ),
  authentication_kind: z.enum(['bearer', 'header', 'basic', 'query', 'oauth2', 'none']),
  authentication_parameter_name: z.string().optional(),
  permissions: z.array(z.string()),
  side_effect_kind: z.enum(['read', 'create', 'update', 'delete', 'send', 'trigger']),
  side_effect_description: z.string(),
});

export type LlmCapabilityDraft = z.infer<typeof LlmCapabilityDraftSchema>;

export interface IngestionIssue {
  severity: 'error' | 'warning';
  provider_id: string;
  capability_id?: string;
  code: string;
  message: string;
}

/** Result of validating one draft, including the confidence the record earned. */
export interface DraftValidation {
  ok: boolean;
  confidence: number;
  checks: ValidationCheck[];
  issues: IngestionIssue[];
}

export interface ValidationCheck {
  name:
    | 'endpoint_exists'
    | 'http_method_exists'
    | 'required_parameters_identified'
    | 'request_schema_valid'
    | 'response_schema_valid'
    | 'authentication_identified'
    | 'api_version_identified'
    | 'source_location_recorded'
    | 'openapi_cross_check';
  passed: boolean;
  /** `false` when the check does not apply (e.g. cross-check with no OpenAPI available). */
  applicable: boolean;
  detail?: string;
}

export interface ProviderIngestionResult {
  provider_id: string;
  /** `skipped` means the content hash was unchanged — nothing was re-parsed or re-extracted. */
  status: 'ingested' | 'skipped' | 'failed';
  content_hash: string;
  capability_count: number;
  issues: IngestionIssue[];
  /** How many LLM extraction calls this run actually made. 0 on the OpenAPI path. */
  llm_calls: number;
}
