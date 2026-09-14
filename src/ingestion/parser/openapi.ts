import type { CapabilityAuthentication, SideEffectKind, SideEffects } from '@/knowledge/capability';
import type { HttpMethod } from '@/knowledge/implementation';
import { normalizeJsonType, type JsonSchemaNode } from '@/knowledge/schema';
import type { ProviderSeed } from '../sources';
import type { CapabilityDraft, DraftParameter, IngestionIssue } from '../types';

/**
 * Path A — deterministic OpenAPI parsing.
 *
 * Nothing in this file calls a model. Every fact it emits (paths, methods,
 * parameters, schemas, auth, scopes, versions, examples) is stated by the
 * document, and an LLM cannot state it more accurately than the machine-
 * readable spec already does (architecture.md section 5).
 *
 * Supports OpenAPI 3.0 and 3.1, including 3.1's top-level `webhooks` object,
 * which is where provider events (`payment_intent.succeeded`) come from.
 */

interface OpenApiDocument {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: Array<{ url: string }>;
  paths?: Record<string, PathItem>;
  webhooks?: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, JsonSchemaNode>;
    securitySchemes?: Record<string, SecurityScheme>;
    parameters?: Record<string, OpenApiParameter>;
  };
  security?: Array<Record<string, string[]>>;
}

interface PathItem {
  parameters?: OpenApiParameter[];
  get?: Operation;
  post?: Operation;
  put?: Operation;
  patch?: Operation;
  delete?: Operation;
}

interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  deprecated?: boolean;
  parameters?: OpenApiParameter[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: JsonSchemaNode; example?: unknown }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: JsonSchemaNode }> }>;
  security?: Array<Record<string, string[]>>;
  'x-integrelli-capability'?: string;
  'x-ratelimit'?: { requests?: number; window_seconds?: number; note?: string };
}

interface OpenApiParameter {
  $ref?: string;
  name?: string;
  in?: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: JsonSchemaNode;
}

interface SecurityScheme {
  type: 'http' | 'apiKey' | 'oauth2' | 'openIdConnect';
  scheme?: string;
  in?: 'header' | 'query' | 'cookie';
  name?: string;
  description?: string;
}

const HTTP_METHODS: Array<{ key: keyof PathItem; method: HttpMethod }> = [
  { key: 'get', method: 'GET' },
  { key: 'post', method: 'POST' },
  { key: 'put', method: 'PUT' },
  { key: 'patch', method: 'PATCH' },
  { key: 'delete', method: 'DELETE' },
];

export interface OpenApiParseResult {
  drafts: CapabilityDraft[];
  issues: IngestionIssue[];
  /** `METHOD path` keys, used by the validator to cross-check documentation-derived drafts. */
  operationIndex: Set<string>;
  /** Version taken from the document itself, when it states one. */
  documentVersion?: string;
}

export function parseOpenApi(content: string, seed: ProviderSeed): OpenApiParseResult {
  const issues: IngestionIssue[] = [];
  let document: OpenApiDocument;
  try {
    document = JSON.parse(content) as OpenApiDocument;
  } catch (err) {
    return {
      drafts: [],
      issues: [
        {
          severity: 'error',
          provider_id: seed.id,
          code: 'openapi_parse_failed',
          message: `Could not parse ${seed.source.location} as JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      operationIndex: new Set(),
    };
  }

  const baseUrl = document.servers?.[0]?.url ?? seed.base_url ?? '';
  if (!baseUrl) {
    issues.push({
      severity: 'warning',
      provider_id: seed.id,
      code: 'missing_server_url',
      message: 'Document declares no servers[] and the seed has no base_url; endpoints will be path-only.',
    });
  }

  const drafts: CapabilityDraft[] = [];
  const operationIndex = new Set<string>();

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const { key, method } of HTTP_METHODS) {
      const operation = pathItem[key] as Operation | undefined;
      if (!operation) continue;
      operationIndex.add(`${method} ${path}`);
      if (operation.deprecated) {
        issues.push({
          severity: 'warning',
          provider_id: seed.id,
          code: 'deprecated_operation',
          message: `${method} ${path} is marked deprecated upstream; skipped.`,
        });
        continue;
      }
      drafts.push(buildDraft({ document, seed, baseUrl, path, method, pathItem, operation, kind: 'action' }));
    }
  }

  for (const [eventName, pathItem] of Object.entries(document.webhooks ?? {})) {
    const operation = pathItem.post ?? pathItem.get;
    if (!operation) continue;
    drafts.push(
      buildWebhookDraft({ document, seed, eventName, operation })
    );
  }

  return { drafts, issues, operationIndex, documentVersion: document.info?.version };
}

interface BuildDraftArgs {
  document: OpenApiDocument;
  seed: ProviderSeed;
  baseUrl: string;
  path: string;
  method: HttpMethod;
  pathItem: PathItem;
  operation: Operation;
  kind: 'action';
}

function buildDraft(args: BuildDraftArgs): CapabilityDraft {
  const { document, seed, baseUrl, path, method, pathItem, operation } = args;

  const rawParameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]
    .map((p) => resolveParameter(document, p))
    .filter((p): p is OpenApiParameter => Boolean(p));

  const parameters: DraftParameter[] = rawParameters
    .filter((p) => p.in === 'path' || p.in === 'query' || p.in === 'header')
    .map((p) => ({
      name: p.name ?? '',
      location: p.in as DraftParameter['location'],
      required: p.in === 'path' ? true : Boolean(p.required),
      type: toDraftType(normalizeJsonType(p.schema?.type, p.schema)),
      description: p.description ?? p.schema?.description,
      format: typeof p.schema?.format === 'string' ? p.schema.format : undefined,
      enum: p.schema?.enum,
    }))
    .filter((p) => p.name.length > 0);

  const requestContent = pickJsonContent(operation.requestBody?.content);
  const requestSchema = requestContent ? dereference(document, requestContent.schema) : null;
  const responseSchema = dereference(document, pickSuccessResponseSchema(operation));

  const idempotencyHeader = parameters.find((p) => p.name.toLowerCase() === 'idempotency-key');

  return {
    provider_id: seed.id,
    api_version: document.info?.version ?? seed.version,
    kind: 'action',
    name: deriveCapabilityName(method, path, operation),
    description: (operation.summary ?? operation.description ?? `${method} ${path}`).trim(),
    protocol: 'rest',
    method,
    endpoint: `${baseUrl}${path}`,
    path_parameters: extractPathParameters(path),
    headers: requestContent?.contentType ? { 'Content-Type': requestContent.contentType } : {},
    request_content_type: requestContent?.contentType,
    parameters,
    request_schema: requestSchema,
    response_schema: responseSchema,
    authentication: resolveAuthentication(document, operation, seed),
    permissions: resolveScopes(document, operation),
    rate_limits: operation['x-ratelimit'] ?? seed.rate_limits,
    idempotency: idempotencyHeader
      ? { supported: true, mechanism: 'Idempotency-Key request header', key_location: 'header' }
      : seed.idempotency,
    side_effects: inferSideEffects(method, path, operation.summary ?? operation.description ?? ''),
    source_pointer: `#/paths/${escapePointer(path)}/${args.method.toLowerCase()}`,
    extractor: 'openapi',
  };
}

interface BuildWebhookArgs {
  document: OpenApiDocument;
  seed: ProviderSeed;
  eventName: string;
  operation: Operation;
}

/**
 * An event capability has no inputs — it is emitted at us. Its *outputs* are
 * the event payload, which is exactly what a downstream step needs to map from.
 */
function buildWebhookDraft(args: BuildWebhookArgs): CapabilityDraft {
  const { document, seed, eventName, operation } = args;
  const payloadContent = pickJsonContent(operation.requestBody?.content);

  return {
    provider_id: seed.id,
    api_version: document.info?.version ?? seed.version,
    kind: 'event',
    name: snakeCase(eventName),
    description: (operation.summary ?? operation.description ?? `${eventName} event`).trim(),
    protocol: 'webhook',
    method: 'POST',
    endpoint: eventName,
    path_parameters: [],
    headers: {},
    parameters: [],
    request_schema: null,
    response_schema: dereference(document, payloadContent?.schema),
    authentication: { kind: 'none', scheme_description: 'Delivered to a subscriber endpoint; verified by signature, not by our credential.' },
    permissions: [],
    rate_limits: null,
    idempotency: { supported: true, mechanism: 'Event id deduplication' },
    side_effects: { kind: 'trigger', description: `Emitted by ${seed.name} when ${eventName} occurs.`, reversible: false },
    source_pointer: `#/webhooks/${escapePointer(eventName)}/post`,
    extractor: 'openapi',
  };
}

/* ---------------------------------------------------------------- naming -- */

const ACTION_TAIL_VERBS = new Set([
  'send', 'search', 'upload', 'complete', 'cancel', 'refund', 'archive',
  'trash', 'modify', 'watch', 'publish', 'join', 'invite', 'batchdelete',
]);

/**
 * Deterministic capability naming, in precedence order:
 *   1. `x-integrelli-capability` — an explicit pin in the document.
 *   2. RPC-style paths (`/chat.postMessage`) — snake_case the operation name.
 *   3. Derived `<verb>_<resource>` from the HTTP method and path shape.
 *   4. `operationId` — last resort, because machine-generated ids
 *      (`PostCheckoutSessions`) retrieve badly.
 */
export function deriveCapabilityName(method: HttpMethod, path: string, operation?: Operation): string {
  const pinned = operation?.['x-integrelli-capability'];
  if (pinned) return snakeCase(pinned);

  const segments = path.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';

  if (last.includes('.') && !last.includes('{')) return snakeCase(last);

  const literalSegments = segments.filter((s) => !s.startsWith('{'));
  const tail = literalSegments[literalSegments.length - 1] ?? '';

  if (ACTION_TAIL_VERBS.has(tail.toLowerCase())) {
    const resource = literalSegments[literalSegments.length - 2] ?? tail;
    return snakeCase(`${tail}_${singularize(resource)}`);
  }

  const endsWithParameter = last.startsWith('{');
  const resource = qualifyResource(literalSegments, singularize(tail));

  if (method === 'GET') {
    return endsWithParameter ? snakeCase(`get_${resource}`) : snakeCase(`list_${pluralize(resource)}`);
  }
  if (method === 'POST') return snakeCase(`create_${resource}`);
  if (method === 'PUT' || method === 'PATCH') return snakeCase(`update_${resource}`);
  if (method === 'DELETE') return snakeCase(`delete_${resource}`);

  return snakeCase(operation?.operationId ?? `${method}_${resource}`);
}

/**
 * Path segments that carry no meaning in a capability name: version markers,
 * generic containers, and REST scaffolding. `/v1/checkout/sessions` should
 * yield `checkout_session`, but `/gmail/v1/users/{userId}/messages` should
 * yield `message`, not `user_message`.
 */
const GENERIC_PARENT_SEGMENTS = new Set(['api', 'rest', 'users', 'user', 'me', 'objects', 'services', 'resources']);

function qualifyResource(literalSegments: string[], resource: string): string {
  const parent = literalSegments[literalSegments.length - 2];
  if (!parent) return resource;
  const normalizedParent = snakeCase(parent);
  if (/^v\d+$/.test(normalizedParent) || GENERIC_PARENT_SEGMENTS.has(normalizedParent)) return resource;
  if (resource.startsWith(normalizedParent)) return resource;
  return `${normalizedParent}_${resource}`;
}

export function snakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function singularize(word: string): string {
  const w = snakeCase(word);
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('sses') || w.endsWith('shes') || w.endsWith('ches')) return w.slice(0, -2);
  if (w.endsWith('ss')) return w;
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

function pluralize(word: string): string {
  if (word.endsWith('s')) return word;
  if (word.endsWith('y')) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/* ------------------------------------------------------------ resolution -- */

function extractPathParameters(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
}

function toDraftType(type: string): DraftParameter['type'] {
  if (type === 'number' || type === 'integer' || type === 'boolean' || type === 'object' || type === 'array') {
    return type;
  }
  return 'string';
}

function pickJsonContent(
  content: Record<string, { schema?: JsonSchemaNode }> | undefined
): { contentType: string; schema?: JsonSchemaNode } | null {
  if (!content) return null;
  const preferred = ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data'];
  for (const contentType of preferred) {
    if (content[contentType]) return { contentType, schema: content[contentType].schema };
  }
  const [contentType, value] = Object.entries(content)[0] ?? [];
  return contentType ? { contentType, schema: value?.schema } : null;
}

function pickSuccessResponseSchema(operation: Operation): JsonSchemaNode | undefined {
  const responses = operation.responses ?? {};
  for (const status of ['200', '201', '202', 'default']) {
    const content = pickJsonContent(responses[status]?.content);
    if (content?.schema) return content.schema;
  }
  return undefined;
}

const MAX_REF_DEPTH = 6;

/** Inlines `#/components/...` refs. Depth-capped, so a recursive spec cannot hang ingestion. */
function dereference(
  document: OpenApiDocument,
  schema: JsonSchemaNode | undefined,
  depth = 0
): JsonSchemaNode | null {
  if (!schema) return null;
  if (depth > MAX_REF_DEPTH) return { type: 'object', description: 'Truncated: maximum $ref depth reached.' };

  const ref = typeof schema.$ref === 'string' ? schema.$ref : undefined;
  if (ref) {
    const resolved = resolvePointer(document, ref);
    if (!resolved) return { type: 'object', description: `Unresolved $ref: ${ref}` };
    return dereference(document, resolved, depth + 1);
  }

  const out: JsonSchemaNode = { ...schema };
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, child]) => [key, dereference(document, child, depth + 1) ?? {}])
    );
  }
  if (schema.items) out.items = dereference(document, schema.items, depth + 1) ?? {};

  const allOf = schema.allOf as JsonSchemaNode[] | undefined;
  if (Array.isArray(allOf)) {
    const merged: JsonSchemaNode = { type: 'object', properties: {}, required: [] };
    for (const part of allOf) {
      const resolvedPart = dereference(document, part, depth + 1);
      if (!resolvedPart) continue;
      Object.assign(merged.properties as Record<string, JsonSchemaNode>, resolvedPart.properties ?? {});
      (merged.required as string[]).push(...(resolvedPart.required ?? []));
    }
    delete out.allOf;
    out.type = 'object';
    out.properties = { ...(merged.properties as Record<string, JsonSchemaNode>), ...(out.properties ?? {}) };
    out.required = [...new Set([...(merged.required as string[]), ...(out.required ?? [])])];
  }

  return out;
}

function resolvePointer(document: OpenApiDocument, ref: string): JsonSchemaNode | undefined {
  if (!ref.startsWith('#/')) return undefined;
  let current: unknown = document;
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current as JsonSchemaNode | undefined;
}

function resolveParameter(document: OpenApiDocument, parameter: OpenApiParameter): OpenApiParameter | null {
  if (!parameter.$ref) return parameter;
  const resolved = resolvePointer(document, parameter.$ref) as unknown as OpenApiParameter | undefined;
  return resolved ?? null;
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

/* ----------------------------------------------------------------- auth -- */

function resolveAuthentication(
  document: OpenApiDocument,
  operation: Operation,
  seed: ProviderSeed
): CapabilityAuthentication {
  const requirement = (operation.security ?? document.security ?? [])[0];
  const schemeName = requirement ? Object.keys(requirement)[0] : undefined;
  const scheme = schemeName ? document.components?.securitySchemes?.[schemeName] : undefined;

  if (!scheme) {
    return { kind: 'bearer', env_var_name: seed.credential_env_var, scheme_description: 'Assumed from the provider registry; the document states no security scheme.' };
  }

  if (scheme.type === 'oauth2' || scheme.type === 'openIdConnect') {
    return { kind: 'oauth2', env_var_name: seed.credential_env_var, scheme_description: scheme.description };
  }
  if (scheme.type === 'http') {
    return scheme.scheme === 'basic'
      ? { kind: 'basic', env_var_name: seed.credential_env_var, scheme_description: scheme.description }
      : { kind: 'bearer', env_var_name: seed.credential_env_var, scheme_description: scheme.description };
  }
  if (scheme.type === 'apiKey') {
    return {
      kind: scheme.in === 'query' ? 'query' : 'header',
      parameter_name: scheme.name,
      env_var_name: seed.credential_env_var,
      scheme_description: scheme.description,
    };
  }
  return { kind: 'none' };
}

function resolveScopes(document: OpenApiDocument, operation: Operation): string[] {
  const requirements = operation.security ?? document.security ?? [];
  const scopes = new Set<string>();
  for (const requirement of requirements) {
    for (const list of Object.values(requirement)) {
      for (const scope of list) scopes.add(scope);
    }
  }
  return [...scopes];
}

/* --------------------------------------------------------- side effects -- */

export function inferSideEffects(method: HttpMethod, path: string, summary: string): SideEffects {
  const text = `${path} ${summary}`.toLowerCase();
  let kind: SideEffectKind;

  if (method === 'GET') kind = 'read';
  else if (method === 'DELETE') kind = 'delete';
  else if (method === 'PUT' || method === 'PATCH') kind = 'update';
  else if (/\bsend\b|message|email|sms|notify/.test(text)) kind = 'send';
  else kind = 'create';

  const reversible = kind === 'read' || kind === 'create' || kind === 'update';
  return {
    kind,
    description: summary || `${method} ${path}`,
    reversible: kind === 'send' ? false : reversible,
  };
}
