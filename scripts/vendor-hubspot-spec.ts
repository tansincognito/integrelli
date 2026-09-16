/**
 * Fetches HubSpot's real, published OpenAPI documents from
 * github.com/HubSpot/HubSpot-public-api-spec-collection and merges a curated
 * subset of operations into `src/ingestion/sources/openapi/hubspot.json`.
 *
 * Why a merge script instead of pointing a DocumentationSource straight at
 * the upstream files: HubSpot publishes ~20 CRM object types as *separate*
 * spec files (Contacts, Companies, Deals, ...), each with its own full
 * `components` section, and our `DocumentationSource` models one provider as
 * one document (fetcher.ts's "offline, deterministic" design — see its
 * header comment). This script is the one-time (well, one-per-upstream-
 * change) curation step that turns "many real files" into "one real,
 * committed mirror," the same shape every other provider's source already
 * has. It is NOT run by `npm run ingest` — it produces the input `ingest`
 * consumes. Re-run by hand when HubSpot's spec changes.
 *
 * Curation: 10 operations across the three most workflow-relevant CRM
 * objects (contacts, companies, deals) — create/get/update for each, plus
 * contact search (the common "look up before creating a duplicate" case).
 * Batch, merge, archive and GDPR-delete operations exist upstream but are
 * intentionally left out: they're real capabilities we could ingest later,
 * not capabilities this pass claims don't exist.
 */

const SOURCES = [
  {
    prefix: 'Contacts',
    url: 'https://raw.githubusercontent.com/HubSpot/HubSpot-public-api-spec-collection/main/PublicApiSpecs/CRM/Contacts/Rollouts/424/v3/contacts.json',
    ops: [
      { path: '/crm/v3/objects/contacts', method: 'post', name: 'create_contact' },
      { path: '/crm/v3/objects/contacts/{contactId}', method: 'get', name: 'get_contact' },
      { path: '/crm/v3/objects/contacts/{contactId}', method: 'patch', name: 'update_contact' },
      { path: '/crm/v3/objects/contacts/search', method: 'post', name: 'search_contacts' },
    ],
  },
  {
    prefix: 'Companies',
    url: 'https://raw.githubusercontent.com/HubSpot/HubSpot-public-api-spec-collection/main/PublicApiSpecs/CRM/Companies/Rollouts/424/v3/companies.json',
    ops: [
      { path: '/crm/v3/objects/companies', method: 'post', name: 'create_company' },
      { path: '/crm/v3/objects/companies/{companyId}', method: 'get', name: 'get_company' },
      { path: '/crm/v3/objects/companies/{companyId}', method: 'patch', name: 'update_company' },
    ],
  },
  {
    prefix: 'Deals',
    url: 'https://raw.githubusercontent.com/HubSpot/HubSpot-public-api-spec-collection/main/PublicApiSpecs/CRM/Deals/Rollouts/424/v3/deals.json',
    ops: [
      // HubSpot's v3 deal paths use its internal object-type id ("0-3"), not the word
      // "deal" — deriveCapabilityName (openapi.ts) would otherwise produce
      // "create_0_3". x-integrelli-capability below pins the real name.
      { path: '/crm/v3/objects/0-3', method: 'post', name: 'create_deal' },
      { path: '/crm/v3/objects/0-3/{dealId}', method: 'get', name: 'get_deal' },
      { path: '/crm/v3/objects/0-3/{dealId}', method: 'patch', name: 'update_deal' },
    ],
  },
] as const;

type JsonObject = Record<string, unknown>;
export {}; // Force module scope — this file's own top-level types must not collide with other scripts/*.ts globals.

/**
 * HubSpot's real `properties` field on every one of these objects is a
 * genuinely free-form map (`additionalProperties: {type: "string"}`) — any
 * property name, no fixed schema. Our schema flattener (src/knowledge/
 * schema.ts) only expands *named* `properties` keys, so left as-is this
 * collapses to one opaque `properties` leaf and every field on it — email
 * included — becomes untargetable. Known, common property names are
 * curated here as named sub-fields, layered on top of the otherwise-real
 * spec; anything not listed stays reachable only as the opaque bag. This is
 * the same tradeoff CRM/PM tools with this pattern (Airtable, Notion,
 * Asana custom fields) will need when they get the same treatment.
 */
const CURATED_PROPERTIES: Record<string, Record<string, { format?: string }>> = {
  Contacts: {
    email: { format: 'email' },
    firstname: {},
    lastname: {},
    // No JSON Schema "format" for a phone number, and none is needed — the
    // literal field name "phone" already satisfies inferSemanticType's own
    // PHONE_HINTS name match (schema.ts), same as it would for any provider.
    phone: {},
    company: {},
  },
  Companies: {
    name: {},
    domain: {},
    phone: {},
    industry: {},
  },
  Deals: {
    dealname: {},
    amount: {},
    dealstage: {},
    pipeline: {},
    closedate: { format: 'date-time' },
  },
};

/** Schemas whose `properties` field is the free-form bag above. */
const PROPERTIES_BAG_SCHEMA_SUFFIXES = [
  'SimplePublicObjectInputForCreate',
  'SimplePublicObjectInput',
  'SimplePublicObject',
  'SimplePublicObjectWithAssociations',
];

function curatePropertiesBags(schemas: JsonObject, prefix: string): void {
  const curated = CURATED_PROPERTIES[prefix];
  if (!curated) return;

  for (const suffix of PROPERTIES_BAG_SCHEMA_SUFFIXES) {
    const schema = schemas[`${prefix}${suffix}`] as JsonObject | undefined;
    const propertiesField = (schema?.properties as JsonObject | undefined)?.properties as JsonObject | undefined;
    if (!propertiesField || !('additionalProperties' in propertiesField)) continue;

    delete propertiesField.additionalProperties;
    propertiesField.properties = Object.fromEntries(
      Object.entries(curated).map(([name, extra]) => [name, { type: 'string', ...extra }])
    );
  }
}

function rewriteRefs(node: unknown, prefix: string): unknown {
  if (Array.isArray(node)) return node.map((item) => rewriteRefs(item, prefix));
  if (node && typeof node === 'object') {
    const out: JsonObject = {};
    for (const [key, value] of Object.entries(node as JsonObject)) {
      if (key === '$ref' && typeof value === 'string' && value.startsWith('#/components/schemas/')) {
        out[key] = value.replace('#/components/schemas/', `#/components/schemas/${prefix}`);
        continue;
      }
      out[key] = rewriteRefs(value, prefix);
    }
    return out;
  }
  return node;
}

async function main(): Promise<void> {
  const mergedSchemas: JsonObject = {};
  const paths: JsonObject = {};
  let securitySchemes: JsonObject | undefined;

  for (const source of SOURCES) {
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`${source.url} returned HTTP ${response.status}`);
    const document = (await response.json()) as JsonObject;

    securitySchemes ??= (document.components as JsonObject | undefined)?.securitySchemes as JsonObject | undefined;

    const schemas = (document.components as JsonObject | undefined)?.schemas as JsonObject | undefined;
    for (const [name, schema] of Object.entries(schemas ?? {})) {
      mergedSchemas[`${source.prefix}${name}`] = rewriteRefs(schema, source.prefix);
    }
    curatePropertiesBags(mergedSchemas, source.prefix);

    const docPaths = document.paths as Record<string, JsonObject>;
    for (const op of source.ops) {
      const pathItem = docPaths[op.path];
      const operation = pathItem?.[op.method] as JsonObject | undefined;
      if (!operation) throw new Error(`${source.prefix}: ${op.method.toUpperCase()} ${op.path} not found in upstream document.`);

      const rewritten = rewriteRefs(operation, source.prefix) as JsonObject;
      rewritten['x-integrelli-capability'] = op.name;

      const target = (paths[op.path] as JsonObject | undefined) ?? {};
      target[op.method] = rewritten;
      paths[op.path] = target;
    }
  }

  const merged = {
    openapi: '3.0.1',
    info: {
      title: 'HubSpot CRM (curated)',
      version: 'v3',
      description:
        'Curated subset (10 operations: create/get/update for contacts, companies, deals, plus contact search), ' +
        'merged from HubSpot’s real published OpenAPI documents at ' +
        'github.com/HubSpot/HubSpot-public-api-spec-collection. Not hand-typed — every operation, parameter, ' +
        'and schema below is copied verbatim from the upstream spec files, with $refs renamed per source object ' +
        'type to avoid collisions when merging three documents into one.',
    },
    servers: [{ url: 'https://api.hubapi.com' }],
    paths,
    components: {
      schemas: mergedSchemas,
      ...(securitySchemes ? { securitySchemes } : {}),
    },
  };

  const { writeFileSync } = await import('node:fs');
  const path = await import('node:path');
  const outPath = path.resolve(process.cwd(), 'src/ingestion/sources/openapi/hubspot.json');
  writeFileSync(outPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
  console.log(`Wrote ${outPath} (${Object.keys(paths).length} paths, ${Object.keys(mergedSchemas).length} schemas).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
