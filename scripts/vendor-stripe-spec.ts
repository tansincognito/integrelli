/**
 * Fetches Stripe's real, published OpenAPI document from
 * github.com/stripe/openapi and extracts a curated subset into
 * `src/ingestion/sources/openapi/stripe.json`, replacing the hand-typed
 * "trimmed local mirror" that previously lived there (architecture.md
 * section 15, risk 1 — this is the fix for that risk on the one provider
 * that actually matters for the self-healing-agent flagship: Stripe is the
 * sync source).
 *
 * Same rationale as vendor-asana-spec.ts (offline, deterministic ingestion —
 * see fetcher.ts's header comment): this is a one-time, run-by-hand curation
 * step, not something `npm run ingest` invokes.
 *
 * Curation: the same 6 REST operations this provider already modeled
 * (create/get across checkout sessions, payment links, customers, refunds,
 * payment intents) — now sourced from the real spec3.json instead of
 * hand-typed schemas.
 *
 * The one thing that can't be a straight copy: Stripe's real schemas mark
 * every "related resource" field (payment_intent.customer,
 * payment_intent.latest_charge, ...) as `anyOf: [string, $ref]` — a string
 * ID by default, the full nested object only if the caller passed
 * `expand[]`. Our capability model and its deterministic parser don't
 * resolve `anyOf`/`oneOf` (architecture.md section 15, risk 1); naively
 * closing over every $ref in that union would also pull in most of Stripe's
 * ~1,450-schema graph (Customer -> Subscription -> Invoice -> ...). Since
 * none of these operations pass `expand[]`, the string-id branch is what the
 * API actually returns by default, so collapsing each such union to its
 * string variant is not a lossy simplification for THIS curated slice — it's
 * the accurate default-response shape. `sanitizeExpandableUnions` does that
 * collapse before ref collection ever runs, and records what it collapsed
 * for the info.description note in the output file.
 *
 * Schemas that remain after that pass are still closed over transitively
 * (nested config objects like `payment_links_resource_after_completion`),
 * capped at MAX_DEPTH / MAX_SCHEMAS so one unexpectedly deep chain can't
 * silently balloon the committed file; anything past the cap becomes an
 * explicit stub with an `x-integrelli-truncated` marker instead of silently
 * failing or hanging.
 */

const SPEC_URL = 'https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json';

const OPERATIONS = [
  { path: '/v1/checkout/sessions', method: 'post', name: 'create_checkout_session' },
  { path: '/v1/payment_links', method: 'post', name: 'create_payment_link' },
  { path: '/v1/customers', method: 'post', name: 'create_customer' },
  { path: '/v1/customers/{customer}', method: 'get', name: 'get_customer' },
  { path: '/v1/refunds', method: 'post', name: 'create_refund' },
  { path: '/v1/payment_intents/{intent}', method: 'get', name: 'get_payment_intent' },
] as const;

const MAX_DEPTH = 4;
const MAX_SCHEMAS = 200;

type JsonObject = Record<string, unknown>;
export {}; // Force module scope — this file's own top-level types must not collide with other scripts/*.ts globals.

interface RefSets {
  schemas: Set<string>;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Removes every `anyOf`/`oneOf` union, recursively, in one of two ways:
 *
 * - a plain string alongside one or more `$ref`s (Stripe's "ID unless
 *   expanded" pattern) collapses to just the string branch — the accurate
 *   default-response shape for operations that never pass `expand[]`.
 * - anything else (a union of genuinely different object shapes — Stripe
 *   uses this for `next_action`, `payment_method_options`, discounts,
 *   shipping options, ...) becomes an explicit `x-integrelli-truncated`
 *   stub. Our deterministic parser does not resolve `oneOf`/`anyOf`
 *   (architecture.md section 15, risk 1) so keeping the full branch closure
 *   for these would grow the file for a shape nothing downstream can use.
 *
 * Returns the collapsed and stubbed `#/components/schemas/X` names for the
 * output file's provenance note.
 */
function sanitizeExpandableUnions(node: unknown, collapsed: Set<string>, stubbed: Set<string>): unknown {
  if (Array.isArray(node)) return node.map((item) => sanitizeExpandableUnions(item, collapsed, stubbed));
  if (!isRecord(node)) return node;

  const union = (node.anyOf ?? node.oneOf) as unknown;
  if (Array.isArray(union)) {
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

function collectRefs(node: unknown, found: RefSets): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, found);
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string' && value.startsWith('#/components/schemas/')) {
      found.schemas.add(value.slice('#/components/schemas/'.length));
      continue;
    }
    collectRefs(value, found);
  }
}

async function main(): Promise<void> {
  const response = await fetch(SPEC_URL);
  if (!response.ok) throw new Error(`${SPEC_URL} returned HTTP ${response.status}`);
  const document = (await response.json()) as JsonObject;

  const allPaths = document.paths as Record<string, JsonObject>;
  const schemaSource = (document.components as JsonObject).schemas as Record<string, unknown>;

  const paths: JsonObject = {};
  const collapsedRefs = new Set<string>();
  const stubbedUnionRefs = new Set<string>();
  const rootRefs: RefSets = { schemas: new Set() };

  for (const op of OPERATIONS) {
    const pathItem = allPaths[op.path];
    const operation = pathItem?.[op.method] as JsonObject | undefined;
    if (!operation) throw new Error(`${op.method.toUpperCase()} ${op.path} not found in upstream document.`);

    const sanitized = sanitizeExpandableUnions(
      JSON.parse(JSON.stringify(operation)),
      collapsedRefs,
      stubbedUnionRefs
    ) as JsonObject;
    sanitized['x-integrelli-capability'] = op.name;
    collectRefs(sanitized, rootRefs);

    const target = (paths[op.path] as JsonObject | undefined) ?? {};
    target[op.method] = sanitized;
    paths[op.path] = target;
  }

  // BFS closure over the remaining (non-expandable) $refs, sanitizing each
  // schema as it's pulled in, capped so an unexpectedly deep chain (e.g. a
  // subscriptions list) can't silently balloon the committed file.
  const includedSchemas = new Map<string, unknown>();
  const truncated = new Set<string>();
  let queue = [...rootRefs.schemas].map((name) => ({ name, depth: 1 }));

  while (queue.length > 0) {
    const { name, depth } = queue.shift()!;
    if (includedSchemas.has(name)) continue;

    const raw = schemaSource[name];
    if (!raw) continue;

    if (depth > MAX_DEPTH || includedSchemas.size >= MAX_SCHEMAS) {
      includedSchemas.set(name, {
        type: 'object',
        description: `Truncated for this curated mirror (depth/size cap). Full schema: ${SPEC_URL}#/components/schemas/${name}`,
        'x-integrelli-truncated': true,
      });
      truncated.add(name);
      continue;
    }

    const sanitized = sanitizeExpandableUnions(JSON.parse(JSON.stringify(raw)), collapsedRefs, stubbedUnionRefs);
    includedSchemas.set(name, sanitized);

    const nested: RefSets = { schemas: new Set() };
    collectRefs(sanitized, nested);
    for (const ref of nested.schemas) {
      if (!includedSchemas.has(ref)) queue.push({ name: ref, depth: depth + 1 });
    }
  }

  const schemas: JsonObject = {};
  for (const [name, schema] of includedSchemas) schemas[name] = schema;

  const merged = {
    openapi: '3.0.0',
    info: {
      title: 'Stripe API (curated)',
      version: document.info && (document.info as JsonObject).version,
      description:
        'Curated subset (6 operations: create checkout session, create payment link, ' +
        'create/get customer, create refund, get payment intent) extracted verbatim from ' +
        `Stripe's real published OpenAPI document at ${SPEC_URL}. ` +
        `${collapsedRefs.size} "expandable resource" anyOf unions (customer, latest_charge, ...) were ` +
        'collapsed to their plain-string-id branch, which is what these operations return by default ' +
        `without expand[]; ${stubbedUnionRefs.size} other oneOf/anyOf unions (next_action, ` +
        'payment_method_options, ...) were stubbed to a plain object because our deterministic parser ' +
        `does not resolve unions — see this script's header comment. ${truncated.size ? `${truncated.size} nested ` +
        `schema(s) beyond depth ${MAX_DEPTH} were also stubbed (x-integrelli-truncated): ${[...truncated].join(', ')}.` : 'No schema hit the depth/size cap.'} ` +
        'Webhook event payloads (payment_intent.succeeded, checkout.session.completed) are NOT included: ' +
        'spec3.json has no `webhooks` section (confirmed against the live document — Stripe does not ' +
        'publish per-event-type OpenAPI schemas here), so those two capabilities stay hand-modeled from ' +
        "Stripe's Event object documentation in this file's sibling webhook block, added by hand below.",
    },
    servers: [{ url: 'https://api.stripe.com' }],
    security: [{ bearerAuth: [] }],
    paths,
    // Not present in the real spec (see info.description above) — kept
    // hand-modeled and pinned via x-integrelli-capability, same as before.
    webhooks: {
      'payment_intent.succeeded': {
        post: {
          summary: 'Occurs when a payment succeeds: the PaymentIntent has moved to the succeeded status and funds are captured.',
          'x-integrelli-capability': 'payment_intent_succeeded',
          requestBody: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/event_payment_intent_succeeded' } },
            },
          },
          responses: { '200': { description: 'Acknowledged' } },
        },
      },
      'checkout.session.completed': {
        post: {
          summary: 'Occurs when a customer completes a Checkout Session.',
          'x-integrelli-capability': 'checkout_session_completed',
          requestBody: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/event_checkout_session_completed' } },
            },
          },
          responses: { '200': { description: 'Acknowledged' } },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Stripe secret API key sent as a bearer token.' },
      },
      schemas: {
        ...schemas,
        event_payment_intent_succeeded: {
          type: 'object',
          required: ['id', 'type', 'data'],
          properties: {
            id: { type: 'string', description: 'Unique identifier of the event.' },
            type: { type: 'string', enum: ['payment_intent.succeeded'] },
            created: { type: 'integer', description: 'Unix timestamp at which the event occurred.' },
            data: {
              type: 'object',
              required: ['object'],
              properties: { object: { $ref: '#/components/schemas/payment_intent' } },
            },
          },
        },
        event_checkout_session_completed: {
          type: 'object',
          required: ['id', 'type', 'data'],
          properties: {
            id: { type: 'string', description: 'Unique identifier of the event.' },
            type: { type: 'string', enum: ['checkout.session.completed'] },
            created: { type: 'integer', description: 'Unix timestamp at which the event occurred.' },
            data: {
              type: 'object',
              required: ['object'],
              properties: { object: { $ref: '#/components/schemas/checkout.session' } },
            },
          },
        },
      },
    },
  };

  const { writeFileSync } = await import('node:fs');
  const path = await import('node:path');
  const outPath = path.resolve(process.cwd(), 'src/ingestion/sources/openapi/stripe.json');
  writeFileSync(outPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
  console.log(
    `Wrote ${outPath} (${Object.keys(paths).length} paths, ${Object.keys(schemas).length} schemas, ` +
      `${collapsedRefs.size} expandable unions collapsed, ${truncated.size} schemas truncated).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
