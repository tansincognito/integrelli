import { apiVersionId } from '@/knowledge/api-version';
import {
  capabilityId,
  type Capability,
  type CapabilityCategory,
  type CapabilityInput,
  type CapabilityOutput,
} from '@/knowledge/capability';
import { implementationId, type Implementation } from '@/knowledge/implementation';
import { flattenSchema, inferSemanticType, normalizeJsonType } from '@/knowledge/schema';
import type { ProviderSeed } from './sources';
import type { CapabilityDraft } from './types';

/**
 * Stage 4 — normalization. Turns a parser's draft into the canonical
 * (Capability, Implementation) pair, with the split that the whole design rests
 * on: *what it does* on the capability, *how it is called* on the
 * implementation.
 *
 * Confidence and `last_verified` are deliberately left at zero/empty here. The
 * normalizer states facts; the validator decides how much they are trusted.
 */
export interface NormalizedCapability {
  capability: Capability;
  implementation: Implementation;
}

export function normalizeDraft(draft: CapabilityDraft, seed: ProviderSeed): NormalizedCapability {
  const id = capabilityId(draft.provider_id, draft.name);
  const versionId = apiVersionId(draft.provider_id, draft.api_version);

  const capability: Capability = {
    id,
    provider_id: draft.provider_id,
    api_version_id: versionId,
    kind: draft.kind,
    name: draft.name,
    description: draft.description,
    category: draft.category ?? inferCategory(draft, seed),
    inputs: buildInputs(draft),
    outputs: buildOutputs(draft),
    authentication: draft.authentication,
    permissions: draft.permissions,
    rate_limits: draft.rate_limits,
    idempotency: draft.idempotency,
    side_effects: draft.side_effects ?? {
      kind: draft.kind === 'event' ? 'trigger' : 'create',
      description: draft.description,
      reversible: false,
    },
    source: {
      document_source_id: seed.source.id,
      pointer: draft.source_pointer,
      upstream_url: seed.source.upstream_url,
      extractor: draft.extractor,
      extraction_model: draft.extraction_model,
      extracted_at: new Date().toISOString(),
    },
    confidence: 0,
    last_verified: '',
  };

  const implementation: Implementation = {
    id: implementationId(id, draft.protocol),
    capability_id: id,
    protocol: draft.protocol,
    method: draft.method,
    endpoint: draft.endpoint,
    path_parameters: draft.path_parameters,
    headers: draft.headers,
    request_schema: draft.request_schema,
    response_schema: draft.response_schema,
    request_content_type: draft.request_content_type,
  };

  return { capability, implementation };
}

/**
 * Inputs are the union of non-body parameters and the flattened request body.
 * Both are addressed by dotted path, so a mapping target reads the same whether
 * it lands in a query string or three levels into a JSON body.
 */
function buildInputs(draft: CapabilityDraft): CapabilityInput[] {
  const fromParameters: CapabilityInput[] = draft.parameters
    .filter((parameter) => parameter.location !== 'body')
    .map((parameter) => {
      const type = normalizeJsonType(parameter.type);
      return {
        path: parameter.name,
        name: parameter.name,
        type,
        required: parameter.required,
        description: parameter.description,
        format: parameter.format,
        enum: parameter.enum,
        semantic_type: inferSemanticType(parameter.name, type, parameter.format),
        location: parameter.location,
      };
    });

  const fromBody: CapabilityInput[] = flattenSchema(draft.request_schema).map((field) => ({
    ...field,
    location: 'body' as const,
  }));

  const bodyParameters: CapabilityInput[] = draft.parameters
    .filter((parameter) => parameter.location === 'body' && !fromBody.some((f) => f.path === parameter.name))
    .map((parameter) => {
      const type = normalizeJsonType(parameter.type);
      return {
        path: parameter.name,
        name: parameter.name,
        type,
        required: parameter.required,
        description: parameter.description,
        semantic_type: inferSemanticType(parameter.name, type, parameter.format),
        location: 'body' as const,
      };
    });

  return dedupeByPath([...fromParameters, ...fromBody, ...bodyParameters]);
}

function buildOutputs(draft: CapabilityDraft): CapabilityOutput[] {
  return dedupeByPath(flattenSchema(draft.response_schema));
}

function dedupeByPath<T extends { path: string }>(fields: T[]): T[] {
  const seen = new Map<string, T>();
  for (const field of fields) {
    if (!seen.has(field.path)) seen.set(field.path, field);
  }
  return [...seen.values()];
}

const CATEGORY_HINTS: Array<{ pattern: RegExp; category: CapabilityCategory }> = [
  { pattern: /payment|charge|invoice|checkout|refund|subscription|price/, category: 'payment' },
  { pattern: /email|message|draft|mail/, category: 'email' },
  { pattern: /channel|chat|conversation|slack|sms/, category: 'messaging' },
  { pattern: /contact|deal|company|crm|lead/, category: 'crm' },
  { pattern: /speech|voice|audio|video|image/, category: 'media' },
  { pattern: /completion|embedding|model|prompt/, category: 'ai' },
  { pattern: /file|upload|bucket|storage/, category: 'storage' },
  { pattern: /user|auth|token|permission/, category: 'identity' },
];

/**
 * Category is a coarse label used for filtering and for the planner prompt.
 * Provider default first, name/description hints only when they clearly say
 * otherwise — Gmail is email, but `gmail.list_labels` is not a payment.
 */
function inferCategory(draft: CapabilityDraft, seed: ProviderSeed): CapabilityCategory {
  const text = `${draft.name} ${draft.description}`.toLowerCase();
  for (const hint of CATEGORY_HINTS) {
    if (hint.pattern.test(text)) return hint.category;
  }
  return seed.category;
}
