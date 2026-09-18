/**
 * Curates Gmail's real, published Google API Discovery document
 * (gmail.googleapis.com/$discovery/rest?version=v1) into
 * `src/ingestion/sources/openapi/gmail.json`, converted to OpenAPI 3 shape.
 *
 * Discovery documents are a different format from OpenAPI/Swagger entirely:
 * operations live at `resources.<r>.resources.<r2>.methods.<name>`, refs are
 * *bare schema names* (`{"$ref": "Message"}`, not a JSON pointer), parameters
 * are a dict keyed by name (not an array) with `location` instead of `in`,
 * and top-level `schemas` replaces `components.schemas`. `rewriteBareRefs`
 * turns every bare ref into the `#/components/schemas/X` pointer our own
 * ingestion parser (and openapi3-curator's ref closure, reused here for the
 * schema graph) already knows how to resolve.
 */

import { closeSchemas, collectRefs, sanitizeExpandableUnions, type JsonObject } from './lib/openapi3-curator';

const DISCOVERY_URL = 'https://gmail.googleapis.com/$discovery/rest?version=v1';

interface DiscoveryOperation {
  resourcePath: string[]; // e.g. ['users', 'messages']
  methodName: string; // e.g. 'send'
  capabilityName: string;
}

const OPERATIONS: DiscoveryOperation[] = [
  { resourcePath: ['users', 'messages'], methodName: 'send', capabilityName: 'send_message' },
  { resourcePath: ['users', 'messages'], methodName: 'get', capabilityName: 'get_message' },
  { resourcePath: ['users', 'messages'], methodName: 'list', capabilityName: 'list_messages' },
  { resourcePath: ['users', 'drafts'], methodName: 'create', capabilityName: 'create_draft' },
];

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `{"$ref": "Message"}` (Discovery's bare-name refs) -> `{"$ref": "#/components/schemas/Message"}`. */
function rewriteBareRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewriteBareRefs);
  if (!isRecord(node)) return node;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string' && !value.startsWith('#')) {
      out[key] = `#/components/schemas/${value}`;
      continue;
    }
    out[key] = rewriteBareRefs(value);
  }
  return out;
}

/** resourcePath like ['users', 'messages'] means resources.users.resources.messages. */
function findMethod(document: JsonObject, resourcePath: string[], methodName: string): JsonObject {
  let cursor = document.resources as JsonObject;
  for (const segment of resourcePath) {
    const resource = cursor[segment] as JsonObject;
    cursor = (resource.resources as JsonObject) ?? resource;
    if (segment === resourcePath[resourcePath.length - 1]) cursor = resource;
  }
  const methods = (cursor.methods as JsonObject) ?? {};
  const method = methods[methodName] as JsonObject | undefined;
  if (!method) throw new Error(`Method ${resourcePath.join('.')}.${methodName} not found in Gmail discovery document.`);
  return method;
}

async function main(): Promise<void> {
  const response = await fetch(DISCOVERY_URL);
  if (!response.ok) throw new Error(`${DISCOVERY_URL} returned HTTP ${response.status}`);
  const rawDocument = (await response.json()) as JsonObject;
  const document = rewriteBareRefs(rawDocument) as JsonObject;

  const rootUrl = (document.rootUrl as string).replace(/\/$/, '');
  // Discovery format stamps a root-level `id` on every schema definition as
  // a self-identifier (`{"id": "Message", "type": "object", ...}`) — a
  // leftover JSON Schema draft-04 keyword replaced by `$id` in later drafts.
  // Left in place, Ajv reads it as an unsupported schema-id keyword and
  // rejects the capability outright; stripped here, never at the (real,
  // data-carrying) property level.
  const schemaSource = Object.fromEntries(
    Object.entries((document.schemas ?? {}) as Record<string, JsonObject>).map(([name, schema]) => {
      const { id: _discoveryId, ...rest } = schema;
      return [name, rest];
    })
  );
  const oauthScopes = ((document.auth as JsonObject | undefined)?.oauth2 as JsonObject | undefined)?.scopes as
    | Record<string, JsonObject>
    | undefined;

  const paths: JsonObject = {};
  const collapsed = new Set<string>();
  const stubbedUnions = new Set<string>();
  const rootRefs = new Set<string>();

  for (const op of OPERATIONS) {
    const method = findMethod(document, op.resourcePath, op.methodName);
    const httpMethod = (method.httpMethod as string).toLowerCase();
    const path = `/${method.path}`;

    const discoveryParams = (method.parameters ?? {}) as Record<string, JsonObject>;
    const parameters = Object.entries(discoveryParams).map(([name, p]) => ({
      name,
      in: p.location,
      required: Boolean(p.required),
      description: p.description,
      schema: {
        ...(p.type !== undefined ? { type: p.type } : {}),
        ...(p.enum !== undefined ? { enum: p.enum } : {}),
        ...(p.default !== undefined ? { default: p.default } : {}),
      },
    }));

    // Discovery format has no request/response schema split — `send` and
    // `get` both point `raw` at the same shared `Message` type — so it
    // can't put `required` on the schema itself (`raw` is required to send,
    // absent on read). It instead annotates each property with the specific
    // method ids that require it (`annotations.required: ["gmail.users.
    // messages.send", ...]`), prose-adjacent metadata rather than a
    // standard JSON Schema keyword. Translate that into a real `required`
    // array scoped to this one operation's request body.
    let requestSchema = method.request as JsonObject | undefined;
    if (requestSchema && typeof requestSchema.$ref === 'string') {
      const refName = requestSchema.$ref.replace('#/components/schemas/', '');
      const referenced = schemaSource[refName] as JsonObject | undefined;
      const requiredHere = Object.entries((referenced?.properties as Record<string, JsonObject> | undefined) ?? {})
        .filter(([, prop]) => ((prop.annotations as JsonObject | undefined)?.required as string[] | undefined)?.includes(method.id as string))
        .map(([name]) => name);
      if (requiredHere.length > 0) requestSchema = { allOf: [requestSchema], required: requiredHere };
    }

    const operation: JsonObject = {
      summary: (method.description as string | undefined)?.split('\n')[0],
      description: method.description,
      'x-integrelli-capability': op.capabilityName,
      parameters,
      ...(requestSchema
        ? { requestBody: { required: true, content: { 'application/json': { schema: requestSchema } } } }
        : {}),
      responses: {
        200: {
          description: 'Successful response.',
          ...(method.response ? { content: { 'application/json': { schema: method.response } } } : {}),
        },
      },
      ...(Array.isArray(method.scopes) && oauthScopes
        ? { security: [{ oauth2: method.scopes as string[] }] }
        : {}),
    };

    const sanitized = sanitizeExpandableUnions(operation, collapsed, stubbedUnions) as JsonObject;
    collectRefs(sanitized, '#/components/schemas/', rootRefs);

    const target = (paths[path] as JsonObject | undefined) ?? {};
    target[httpMethod] = sanitized;
    paths[path] = target;
  }

  const { schemas, truncated } = closeSchemas(rootRefs, schemaSource, {
    maxDepth: 4,
    maxSchemas: 200,
    specUrl: DISCOVERY_URL,
    collapsed,
    stubbedUnions,
  });

  const scopesUsed = new Set<string>();
  for (const op of OPERATIONS) {
    const method = findMethod(document, op.resourcePath, op.methodName);
    for (const scope of (method.scopes as string[] | undefined) ?? []) scopesUsed.add(scope);
  }
  const filteredScopes: JsonObject = {};
  if (oauthScopes) {
    for (const scope of scopesUsed) if (oauthScopes[scope]) filteredScopes[scope] = oauthScopes[scope].description;
  }

  const merged: JsonObject = {
    openapi: '3.0.0',
    info: {
      title: 'Gmail API (curated real subset)',
      version: (document.version as string) ?? 'v1',
      description:
        `Curated subset (${OPERATIONS.length} operations: send/get/list messages, create a draft) converted ` +
        `verbatim from Gmail's real published Google API Discovery document at ${DISCOVERY_URL} — a different ` +
        `format from OpenAPI/Swagger (bare-name $refs, dict-shaped parameters, resources.*.methods.* operations); ` +
        `see scripts/vendor-gmail-spec.ts for the conversion. ${collapsed.size} expandable-resource unions ` +
        `collapsed, ${stubbedUnions.size} other unions stubbed. ${truncated.size ? `${truncated.size} nested ` +
        `schema(s) beyond depth were stubbed: ${[...truncated].join(', ')}.` : 'No schema hit the depth/size cap.'}`,
    },
    servers: [{ url: rootUrl }],
    security: [{ oauth2: [] }],
    paths,
    components: {
      securitySchemes: {
        oauth2: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: 'https://accounts.google.com/o/oauth2/auth',
              tokenUrl: 'https://oauth2.googleapis.com/token',
              scopes: filteredScopes,
            },
          },
        },
      },
      schemas,
    },
  };

  const { writeFileSync } = await import('node:fs');
  const path = await import('node:path');
  const outPath = path.resolve(process.cwd(), 'src/ingestion/sources/openapi/gmail.json');
  writeFileSync(outPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
  console.log(
    `Wrote ${outPath} (${Object.keys(paths).length} paths, ${Object.keys(schemas).length} schemas, ` +
      `${collapsed.size} unions collapsed, ${stubbedUnions.size} stubbed, ${truncated.size} depth-capped).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
