/**
 * Shared curation engine for OpenAPI 3.x upstream documents — used by
 * scripts/vendor-*-spec.ts for every provider whose real spec is already
 * OpenAPI 3 (Swagger 2 and Google Discovery sources get their own module;
 * see swagger2-curator.ts and vendor-gmail-spec.ts).
 *
 * Extracted from vendor-stripe-spec.ts, generalized to take a spec URL and
 * an operation list. Same rationale throughout (see that file's header):
 * this is a one-time, run-by-hand step, not something `npm run ingest`
 * invokes, and its job is turning "one real, huge upstream document" into
 * "a small, real, committed mirror covering exactly the operations a
 * provider seed models" — never hand-typed data.
 *
 * The two things every provider needs handled the same way:
 *
 * - "Expandable resource" unions (`anyOf`/`oneOf` offering a plain string
 *   alongside `$ref`s) collapse to the string branch — the accurate
 *   default-response shape for operations that don't request expansion.
 * - Every other `oneOf`/`anyOf` (genuinely different object shapes) becomes
 *   an explicit `x-integrelli-truncated` stub, because the deterministic
 *   parser doesn't resolve unions (architecture.md section 15, risk 1) —
 *   keeping the full branch closure for a shape nothing downstream can use
 *   just grows the file.
 */

export interface CuratedOperation {
  path: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Pins the derived capability name — only needed when the deterministic
   *  name-from-method-and-path would otherwise disagree with the existing
   *  capability id (see openapi.ts's derivation precedence). */
  name?: string;
}

export interface CurateOptions {
  specUrl: string;
  operations: CuratedOperation[];
  outPath: string;
  title: string;
  /** Extra paths/schemas to splice in verbatim (e.g. hand-modeled webhooks) after curation. */
  extra?: { paths?: JsonObject; schemas?: JsonObject; webhooks?: JsonObject };
  maxDepth?: number;
  maxSchemas?: number;
}

export type JsonObject = Record<string, unknown>;

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_SCHEMAS = 200;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sanitizeExpandableUnions(node: unknown, collapsed: Set<string>, stubbed: Set<string>): unknown {
  if (Array.isArray(node)) return node.map((item) => sanitizeExpandableUnions(item, collapsed, stubbed));
  if (!isRecord(node)) return node;

  const union = (node.anyOf ?? node.oneOf) as unknown;
  if (Array.isArray(union) && union.length > 0) {
    const stringBranch = union.find((branch) => isRecord(branch) && branch.type === 'string');
    const refBranches = union.filter((branch) => isRecord(branch) && typeof branch.$ref === 'string');
    if (stringBranch && refBranches.length === union.length - 1 && refBranches.length > 0) {
      for (const branch of refBranches) collapsed.add((branch as JsonObject).$ref as string);
      const { anyOf: _a, oneOf: _o, 'x-expansionResources': _x, ...rest } = node;
      return { ...rest, ...(stringBranch as JsonObject) };
    }

    for (const branch of union) {
      if (isRecord(branch) && typeof branch.$ref === 'string') stubbed.add(branch.$ref);
    }
    return {
      type: 'object',
      description:
        (typeof node.description === 'string' ? `${node.description} ` : '') +
        '(polymorphic field — oneOf/anyOf not resolved in this curated mirror; see upstream schema)',
      'x-integrelli-truncated': true,
    };
  }

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = sanitizeExpandableUnions(value, collapsed, stubbed);
  }
  return out;
}

export function collectRefs(node: unknown, refPrefix: string, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, refPrefix, out);
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string' && value.startsWith(refPrefix)) {
      out.add(value.slice(refPrefix.length));
      continue;
    }
    collectRefs(value, refPrefix, out);
  }
}

/** BFS closure over `#/components/schemas/*` refs, sanitizing and capping as it goes. */
export function closeSchemas(
  rootRefs: Set<string>,
  schemaSource: Record<string, unknown>,
  opts: { maxDepth: number; maxSchemas: number; specUrl: string; collapsed: Set<string>; stubbedUnions: Set<string> }
): { schemas: JsonObject; truncated: Set<string> } {
  const included = new Map<string, unknown>();
  const truncated = new Set<string>();
  const queue = [...rootRefs].map((name) => ({ name, depth: 1 }));

  while (queue.length > 0) {
    const { name, depth } = queue.shift()!;
    if (included.has(name)) continue;

    const raw = schemaSource[name];
    if (!raw) continue;

    if (depth > opts.maxDepth || included.size >= opts.maxSchemas) {
      included.set(name, {
        type: 'object',
        description: `Truncated for this curated mirror (depth/size cap). Full schema: ${opts.specUrl}#/components/schemas/${name}`,
        'x-integrelli-truncated': true,
      });
      truncated.add(name);
      continue;
    }

    const sanitized = sanitizeExpandableUnions(JSON.parse(JSON.stringify(raw)), opts.collapsed, opts.stubbedUnions);
    included.set(name, sanitized);

    const nested = new Set<string>();
    collectRefs(sanitized, '#/components/schemas/', nested);
    for (const ref of nested) if (!included.has(ref)) queue.push({ name: ref, depth: depth + 1 });
  }

  const schemas: JsonObject = {};
  for (const [name, schema] of included) schemas[name] = schema;
  return { schemas, truncated };
}

export async function curateOpenApi3(options: CurateOptions): Promise<void> {
  const { specUrl, operations, outPath, title, extra, maxDepth = DEFAULT_MAX_DEPTH, maxSchemas = DEFAULT_MAX_SCHEMAS } = options;

  const response = await fetch(specUrl);
  if (!response.ok) throw new Error(`${specUrl} returned HTTP ${response.status}`);
  const document = (await response.json()) as JsonObject;

  const allPaths = document.paths as Record<string, JsonObject>;
  const schemaSource = ((document.components as JsonObject | undefined)?.schemas ?? {}) as Record<string, unknown>;
  const parameterSource = ((document.components as JsonObject | undefined)?.parameters ?? {}) as Record<string, unknown>;

  const paths: JsonObject = {};
  const collapsed = new Set<string>();
  const stubbedUnions = new Set<string>();
  const rootRefs = new Set<string>();
  const rootParameterRefs = new Set<string>();

  for (const op of operations) {
    const pathItem = allPaths[op.path];
    const operation = pathItem?.[op.method] as JsonObject | undefined;
    if (!operation) throw new Error(`${op.method.toUpperCase()} ${op.path} not found in upstream document ${specUrl}.`);

    const sanitized = sanitizeExpandableUnions(JSON.parse(JSON.stringify(operation)), collapsed, stubbedUnions) as JsonObject;
    if (op.name) sanitized['x-integrelli-capability'] = op.name;
    collectRefs(sanitized, '#/components/schemas/', rootRefs);
    // A `$ref` to `#/components/parameters/X` (GitHub's spec does this for
    // every path parameter) resolves to nothing if that section is never
    // copied into the curated file — the parser silently drops the
    // parameter, and with it any path placeholder it named (see this
    // module's header: real specs, not hand-typed ones, is the whole point,
    // and this is exactly the kind of gap only real data exposes).
    collectRefs(sanitized, '#/components/parameters/', rootParameterRefs);
    // Path-level parameters apply to every method under this path.
    if (pathItem?.parameters) {
      collectRefs(pathItem.parameters, '#/components/schemas/', rootRefs);
      collectRefs(pathItem.parameters, '#/components/parameters/', rootParameterRefs);
    }

    const target = (paths[op.path] as JsonObject | undefined) ?? {};
    target[op.method] = sanitized;
    if (pathItem?.parameters && !target.parameters) {
      target.parameters = JSON.parse(JSON.stringify(pathItem.parameters));
    }
    paths[op.path] = target;
  }

  const { schemas, truncated } = closeSchemas(rootRefs, schemaSource, { maxDepth, maxSchemas, specUrl, collapsed, stubbedUnions });

  // Parameters can themselves $ref a schema (e.g. a query param whose value
  // is an enum object) — resolve those into the same schema closure.
  const parameters: JsonObject = {};
  for (const name of rootParameterRefs) {
    const raw = parameterSource[name];
    if (!raw) continue;
    const sanitized = sanitizeExpandableUnions(JSON.parse(JSON.stringify(raw)), collapsed, stubbedUnions);
    parameters[name] = sanitized;
    const nestedSchemaRefs = new Set<string>();
    collectRefs(sanitized, '#/components/schemas/', nestedSchemaRefs);
    if (nestedSchemaRefs.size > 0) {
      const nested = closeSchemas(nestedSchemaRefs, schemaSource, { maxDepth, maxSchemas, specUrl, collapsed, stubbedUnions });
      Object.assign(schemas, nested.schemas);
      for (const t of nested.truncated) truncated.add(t);
    }
  }

  if (extra?.paths) Object.assign(paths, extra.paths);

  const merged: JsonObject = {
    openapi: '3.0.0',
    info: {
      title,
      version: (document.info as JsonObject | undefined)?.version ?? '1.0',
      description:
        `Curated subset (${operations.length} operation${operations.length === 1 ? '' : 's'}) extracted verbatim ` +
        `from the real published OpenAPI document at ${specUrl}. ${collapsed.size} "expandable resource" ` +
        `anyOf/oneOf unions were collapsed to their plain-string-id branch (the default-response shape without ` +
        `expansion); ${stubbedUnions.size} other polymorphic unions were stubbed (x-integrelli-truncated) because ` +
        `the deterministic parser does not resolve oneOf/anyOf. ${truncated.size ? `${truncated.size} nested ` +
        `schema(s) beyond depth ${maxDepth} were also stubbed: ${[...truncated].join(', ')}.` : 'No schema hit the depth/size cap.'}`,
    },
    servers: document.servers ?? [],
    ...(document.security ? { security: document.security } : {}),
    paths,
    components: {
      ...(isRecord(document.components) && document.components.securitySchemes
        ? { securitySchemes: document.components.securitySchemes }
        : {}),
      schemas: { ...schemas, ...(extra?.schemas ?? {}) },
      ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
    },
    ...(extra?.webhooks ? { webhooks: extra.webhooks } : {}),
  };

  const { writeFileSync } = await import('node:fs');
  const path = await import('node:path');
  const resolved = path.resolve(process.cwd(), outPath);
  writeFileSync(resolved, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
  console.log(
    `Wrote ${resolved} (${Object.keys(paths).length} paths, ${Object.keys(schemas).length} schemas, ` +
      `${collapsed.size} unions collapsed, ${stubbedUnions.size} unions stubbed, ${truncated.size} depth-capped).`
  );
}
