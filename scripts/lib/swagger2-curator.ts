/**
 * Shared curation engine for Swagger 2.0 upstream documents (Slack,
 * DocuSign, Mailchimp) — converts a curated operation subset into the same
 * OpenAPI 3 shape every other vendor-*-spec.ts script produces, so the
 * ingestion pipeline (openapi.ts) never needs to know Swagger 2 exists.
 *
 * Reuses openapi3-curator.ts's union-sanitizing and ref-closure logic; the
 * only genuinely new problem here is Swagger 2's ref surface being wider
 * than "#/definitions/X":
 *
 * - Slack keeps every request field as its own top-level `in: formData`
 *   parameter (no request-body schema at all) — folded here into a single
 *   `application/x-www-form-urlencoded` request body schema, OpenAPI 3
 *   style.
 * - DocuSign uses a single `in: body` parameter with a `#/definitions/X`
 *   schema ref — a straight local-pointer rewrite to
 *   `#/components/schemas/X`.
 * - Mailchimp's spec splits into hundreds of files on its own schema
 *   server: every `$ref` is an *absolute URL*
 *   (`https://us22.api.mailchimp.com/schema/3.0/...`), not a local pointer.
 *   `inlineRemoteRefs` fetches each one (memoized — the same parameter
 *   fragment is reused across dozens of operations), gives it a synthetic
 *   local name, and rewrites the ref to `#/components/schemas/<name>` —
 *   converting "refs scattered across a schema server" into the same
 *   local-named-ref shape the rest of this pipeline (and our own
 *   ingestion parser, which only resolves `#/...` pointers — never fetches
 *   a URL) already knows how to consume.
 */

import { closeSchemas, collectRefs, sanitizeExpandableUnions, type JsonObject } from './openapi3-curator';

export interface Swagger2Operation {
  path: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  name?: string;
}

export interface CurateSwagger2Options {
  specUrl: string;
  operations: Swagger2Operation[];
  outPath: string;
  title: string;
  maxDepth?: number;
  maxSchemas?: number;
  /** Max distinct absolute-URL $refs to fetch (Mailchimp only) — a safety cap, not expected to bind. */
  maxRemoteFetches?: number;
}

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_SCHEMAS = 200;
const DEFAULT_MAX_REMOTE_FETCHES = 60;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `https://host/schema/3.0/Parameters/FieldSelection.json` -> `Parameters_FieldSelection`. */
function slugFromUrl(url: string): string {
  const withoutQuery = url.split('?')[0];
  const parts = withoutQuery.split('/').filter(Boolean);
  const tail = parts.slice(-2).join('_').replace(/\.json$/i, '');
  return tail.replace(/[^A-Za-z0-9_]/g, '_');
}

/**
 * Walks `node`, fetching every absolute-URL `$ref` (memoized in `schemaPool`
 * under a synthetic name) and rewriting it to `#/components/schemas/<name>`,
 * recursively — so by the time this returns, every ref in `node` is a local
 * pointer into `schemaPool`. Local `#/definitions/...` refs are left alone
 * for the caller to rewrite in one pass afterward.
 */
async function inlineRemoteRefs(
  node: unknown,
  schemaPool: Record<string, unknown>,
  urlToName: Map<string, string>,
  maxFetches: number
): Promise<unknown> {
  if (Array.isArray(node)) {
    const out = [];
    for (const item of node) out.push(await inlineRemoteRefs(item, schemaPool, urlToName, maxFetches));
    return out;
  }
  if (!isRecord(node)) return node;

  const ref = node.$ref;
  if (typeof ref === 'string' && /^https?:\/\//.test(ref)) {
    let name = urlToName.get(ref);
    if (!name) {
      if (urlToName.size >= maxFetches) {
        return { type: 'object', description: `Truncated (remote-ref fetch cap). Full schema: ${ref}`, 'x-integrelli-truncated': true };
      }
      const base = slugFromUrl(ref);
      let unique = base;
      let suffix = 2;
      while (schemaPool[unique] !== undefined) unique = `${base}_${suffix++}`;
      name = unique;
      urlToName.set(ref, name);
      schemaPool[name] = {}; // cycle guard placeholder
      const response = await fetch(ref);
      if (!response.ok) throw new Error(`${ref} returned HTTP ${response.status}`);
      const fetched = await response.json();
      schemaPool[name] = await inlineRemoteRefs(fetched, schemaPool, urlToName, maxFetches);
    }
    const { $ref: _drop, ...siblings } = node;
    return { ...siblings, $ref: `#/components/schemas/${name}` };
  }

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = await inlineRemoteRefs(value, schemaPool, urlToName, maxFetches);
  }
  return out;
}

/** `#/definitions/X` -> `#/components/schemas/X`, recursively, everywhere in `node`. */
function rewriteLocalDefRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewriteLocalDefRefs);
  if (!isRecord(node)) return node;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string' && value.startsWith('#/definitions/')) {
      out[key] = value.replace('#/definitions/', '#/components/schemas/');
      continue;
    }
    out[key] = rewriteLocalDefRefs(value);
  }
  return out;
}

const OAUTH2_FLOW_NAMES: Record<string, string> = {
  implicit: 'implicit',
  password: 'password',
  application: 'clientCredentials',
  accessCode: 'authorizationCode',
};

/** Swagger 2 `securityDefinitions` -> OpenAPI 3 `components.securitySchemes` — same schemes, different envelope. */
function convertSecuritySchemes(defs: Record<string, unknown>): JsonObject {
  const out: JsonObject = {};
  for (const [name, raw] of Object.entries(defs)) {
    if (!isRecord(raw)) continue;
    if (raw.type === 'basic') {
      out[name] = { type: 'http', scheme: 'basic', ...(raw.description ? { description: raw.description } : {}) };
    } else if (raw.type === 'oauth2') {
      const flowName = OAUTH2_FLOW_NAMES[raw.flow as string] ?? 'implicit';
      const flow: JsonObject = { scopes: raw.scopes ?? {} };
      if (flowName !== 'clientCredentials') flow.authorizationUrl = raw.authorizationUrl;
      if (flowName !== 'implicit') flow.tokenUrl = raw.tokenUrl;
      out[name] = { type: 'oauth2', ...(raw.description ? { description: raw.description } : {}), flows: { [flowName]: flow } };
    } else {
      // apiKey (identical shape in both) and anything else pass through unchanged.
      out[name] = raw;
    }
  }
  return out;
}

/** Swagger 2 parameter (`type`/`enum`/`format` inline) -> OpenAPI 3 parameter (`schema: {...}`). */
function toOpenApi3Parameter(p: JsonObject): JsonObject {
  const { name, in: location, description, required, type, enum: enumValues, format, $ref } = p;
  if ($ref) return p; // already a ref into components.parameters-shaped content — left as-is, unused today
  return {
    name,
    in: location,
    ...(description !== undefined ? { description } : {}),
    ...(required !== undefined ? { required } : {}),
    schema: {
      ...(type !== undefined ? { type } : {}),
      ...(enumValues !== undefined ? { enum: enumValues } : {}),
      ...(format !== undefined ? { format } : {}),
    },
  };
}

/** Converts one Swagger 2 operation object (already ref-rewritten) into OpenAPI 3 shape. */
function toOpenApi3Operation(op: JsonObject): JsonObject {
  const params = (op.parameters as JsonObject[] | undefined) ?? [];
  const bodyParam = params.find((p) => p.in === 'body');
  const formParams = params.filter((p) => p.in === 'formData');
  const otherParams = params.filter((p) => p.in !== 'body' && p.in !== 'formData');

  const out: JsonObject = { ...op };
  delete out.consumes;
  delete out.produces;

  if (bodyParam) {
    out.requestBody = {
      required: Boolean(bodyParam.required),
      content: { 'application/json': { schema: bodyParam.schema } },
    };
  } else if (formParams.length > 0) {
    const properties: JsonObject = {};
    const required: string[] = [];
    for (const p of formParams) {
      properties[p.name as string] = {
        ...(p.type !== undefined ? { type: p.type } : {}),
        ...(p.description !== undefined ? { description: p.description } : {}),
        ...(p.enum !== undefined ? { enum: p.enum } : {}),
      };
      if (p.required) required.push(p.name as string);
    }
    out.requestBody = {
      required: required.length > 0,
      content: {
        'application/x-www-form-urlencoded': {
          schema: { type: 'object', properties, ...(required.length ? { required } : {}) },
        },
      },
    };
  }
  if (otherParams.length > 0) out.parameters = otherParams.map((p) => toOpenApi3Parameter(p));
  else delete out.parameters;

  const responses = (op.responses as JsonObject | undefined) ?? {};
  const newResponses: JsonObject = {};
  for (const [code, resp] of Object.entries(responses)) {
    if (isRecord(resp) && resp.schema) {
      const { schema, ...rest } = resp;
      newResponses[code] = { ...rest, content: { 'application/json': { schema } } };
    } else {
      newResponses[code] = resp;
    }
  }
  out.responses = newResponses;

  return out;
}

export async function curateSwagger2(options: CurateSwagger2Options): Promise<void> {
  const {
    specUrl,
    operations,
    outPath,
    title,
    maxDepth = DEFAULT_MAX_DEPTH,
    maxSchemas = DEFAULT_MAX_SCHEMAS,
    maxRemoteFetches = DEFAULT_MAX_REMOTE_FETCHES,
  } = options;

  const response = await fetch(specUrl);
  if (!response.ok) throw new Error(`${specUrl} returned HTTP ${response.status}`);
  const document = (await response.json()) as JsonObject;

  const allPaths = document.paths as Record<string, JsonObject>;
  const localDefinitions = (document.definitions ?? {}) as Record<string, unknown>;

  // Schema pool seeded with every local definition (rewritten to the
  // `#/components/schemas/` namespace so it lines up with remote-fetched
  // entries below) plus anything inlineRemoteRefs fetches along the way.
  const schemaPool: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(localDefinitions)) schemaPool[name] = rewriteLocalDefRefs(schema);

  const urlToName = new Map<string, string>();
  const paths: JsonObject = {};
  const collapsed = new Set<string>();
  const stubbedUnions = new Set<string>();
  const rootRefs = new Set<string>();

  for (const op of operations) {
    const pathItem = allPaths[op.path];
    let operation = pathItem?.[op.method] as JsonObject | undefined;
    if (!operation) {
      // Some Swagger 2 documents (Mailchimp) put the whole path item behind
      // its own $ref to an external file — resolve that first.
      const pathRef = (pathItem as JsonObject | undefined)?.$ref;
      if (pathItem && typeof pathRef === 'string') {
        const resolvedPathItem = (await inlineRemoteRefs(pathItem, schemaPool, urlToName, maxRemoteFetches)) as JsonObject;
        // inlineRemoteRefs turns the path-item $ref into a schema-pool entry; pull it back out.
        const name = urlToName.get(pathRef)!;
        operation = (schemaPool[name] as JsonObject | undefined)?.[op.method] as JsonObject | undefined;
      }
    }
    if (!operation) throw new Error(`${op.method.toUpperCase()} ${op.path} not found in upstream document ${specUrl}.`);

    let resolved = (await inlineRemoteRefs(JSON.parse(JSON.stringify(operation)), schemaPool, urlToName, maxRemoteFetches)) as JsonObject;
    resolved = rewriteLocalDefRefs(resolved) as JsonObject;
    const converted = toOpenApi3Operation(resolved);
    const sanitized = sanitizeExpandableUnions(converted, collapsed, stubbedUnions) as JsonObject;
    if (op.name) sanitized['x-integrelli-capability'] = op.name;
    collectRefs(sanitized, '#/components/schemas/', rootRefs);

    const target = (paths[op.path] as JsonObject | undefined) ?? {};
    target[op.method] = sanitized;
    paths[op.path] = target;
  }

  const { schemas, truncated } = closeSchemas(rootRefs, schemaPool, { maxDepth, maxSchemas, specUrl, collapsed, stubbedUnions });

  const merged: JsonObject = {
    openapi: '3.0.0',
    info: {
      title,
      version: (document.info as JsonObject | undefined)?.version ?? '1.0',
      description:
        `Curated subset (${operations.length} operation${operations.length === 1 ? '' : 's'}) extracted verbatim ` +
        `from the real published Swagger 2.0 document at ${specUrl}, converted to OpenAPI 3 shape (body/formData ` +
        `parameters folded into requestBody, response \`schema\` wrapped in \`content\`) — every field, ` +
        `description and constraint below is copied from the upstream document, only the envelope changed. ` +
        `${collapsed.size} expandable-resource unions collapsed, ${stubbedUnions.size} other unions stubbed. ` +
        `${truncated.size ? `${truncated.size} nested schema(s) beyond depth ${maxDepth} were stubbed: ${[...truncated].join(', ')}.` : 'No schema hit the depth/size cap.'}`,
    },
    servers: document.host ? [{ url: `https://${document.host}${document.basePath ?? ''}` }] : [],
    ...(document.securityDefinitions ? { security: document.security ?? [] } : {}),
    paths,
    components: {
      ...(document.securityDefinitions
        ? { securitySchemes: convertSecuritySchemes(document.securityDefinitions as Record<string, unknown>) }
        : {}),
      schemas,
    },
  };

  const { writeFileSync } = await import('node:fs');
  const path = await import('node:path');
  const resolvedPath = path.resolve(process.cwd(), outPath);
  writeFileSync(resolvedPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
  console.log(
    `Wrote ${resolvedPath} (${Object.keys(paths).length} paths, ${Object.keys(schemas).length} schemas, ` +
      `${urlToName.size} remote refs fetched, ${collapsed.size} unions collapsed, ${stubbedUnions.size} stubbed, ${truncated.size} depth-capped).`
  );
}
