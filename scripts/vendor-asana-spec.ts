/**
 * Fetches Asana's real, published OpenAPI document from github.com/Asana/openapi
 * and extracts a curated subset into `src/ingestion/sources/openapi/asana.json`.
 *
 * Unlike HubSpot (many small per-object files, needing a merge), Asana ships
 * one ~3MB combined YAML document — this script's job is purely extraction:
 * pull the chosen operations plus the transitive closure of every
 * `components.schemas` entry they actually reference, so the committed
 * mirror is small instead of vendoring the whole 3MB file. See
 * vendor-hubspot-spec.ts for the sibling script and the same rationale for
 * why this is a committed local mirror rather than a live fetch at ingest
 * time (fetcher.ts's "offline, deterministic" design).
 *
 * Curation: the same 3 operations this provider always modeled
 * (create/get/update a task) — now sourced from the real spec instead of a
 * hand-typed markdown table, which is what actually needed fixing here.
 */

const SPEC_URL = 'https://raw.githubusercontent.com/Asana/openapi/master/defs/asana_oas.yaml';

const OPERATIONS = [
  { path: '/tasks', method: 'post', name: 'create_task' },
  { path: '/tasks/{task_gid}', method: 'get', name: 'get_task' },
  { path: '/tasks/{task_gid}', method: 'put', name: 'update_task' },
] as const;

type JsonObject = Record<string, unknown>;
export {}; // Force module scope — this file's own top-level types must not collide with other scripts/*.ts globals.

interface RefSets {
  schemas: Set<string>;
  parameters: Set<string>;
}

/** Every `#/components/{schemas,parameters}/X` ref anywhere inside `node`, recursively. */
function collectRefs(node: unknown, found: RefSets): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, found);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as JsonObject)) {
      if (key === '$ref' && typeof value === 'string') {
        if (value.startsWith('#/components/schemas/')) found.schemas.add(value.slice('#/components/schemas/'.length));
        else if (value.startsWith('#/components/parameters/')) found.parameters.add(value.slice('#/components/parameters/'.length));
      }
      collectRefs(value, found);
    }
  }
}

async function main(): Promise<void> {
  const { parse: parseYaml } = await import('yaml');

  const response = await fetch(SPEC_URL);
  if (!response.ok) throw new Error(`${SPEC_URL} returned HTTP ${response.status}`);
  const document = parseYaml(await response.text()) as JsonObject;

  const allPaths = document.paths as Record<string, JsonObject>;
  const paths: JsonObject = {};
  const rootRefs: RefSets = { schemas: new Set(), parameters: new Set() };

  for (const op of OPERATIONS) {
    const pathItem = allPaths[op.path];
    const operation = pathItem?.[op.method] as JsonObject | undefined;
    if (!operation) throw new Error(`${op.method.toUpperCase()} ${op.path} not found in upstream document.`);

    const copy = JSON.parse(JSON.stringify(operation)) as JsonObject;
    copy['x-integrelli-capability'] = op.name;
    collectRefs(copy, rootRefs);

    const target = (paths[op.path] as JsonObject | undefined) ?? {};
    target[op.method] = copy;
    // Path-level parameters (e.g. the {task_gid} path param) apply to every
    // method under this path and are declared once on the pathItem, not
    // repeated per-operation — buildDraft (openapi.ts) reads both.
    if (pathItem?.parameters && !target.parameters) {
      const sharedParams = JSON.parse(JSON.stringify(pathItem.parameters)) as JsonObject;
      target.parameters = sharedParams;
      collectRefs(sharedParams, rootRefs);
    }
    paths[op.path] = target;
  }

  // Transitive closure over BOTH namespaces: a referenced parameter's own
  // `schema` can $ref a schema, and a referenced schema's allOf chain can
  // $ref further schemas (see MAX_REF_DEPTH in openapi.ts).
  const componentsSource = document.components as JsonObject;
  const schemaSource = componentsSource.schemas as Record<string, unknown>;
  const parameterSource = componentsSource.parameters as Record<string, unknown>;
  const includedSchemas = new Set<string>();
  const includedParameters = new Set<string>();
  const schemaQueue = [...rootRefs.schemas];
  const parameterQueue = [...rootRefs.parameters];

  while (schemaQueue.length > 0 || parameterQueue.length > 0) {
    while (schemaQueue.length > 0) {
      const name = schemaQueue.pop()!;
      if (includedSchemas.has(name)) continue;
      includedSchemas.add(name);
      const schema = schemaSource[name];
      if (!schema) continue;
      const nested: RefSets = { schemas: new Set(), parameters: new Set() };
      collectRefs(schema, nested);
      for (const ref of nested.schemas) if (!includedSchemas.has(ref)) schemaQueue.push(ref);
      for (const ref of nested.parameters) if (!includedParameters.has(ref)) parameterQueue.push(ref);
    }
    while (parameterQueue.length > 0) {
      const name = parameterQueue.pop()!;
      if (includedParameters.has(name)) continue;
      includedParameters.add(name);
      const parameter = parameterSource[name];
      if (!parameter) continue;
      const nested: RefSets = { schemas: new Set(), parameters: new Set() };
      collectRefs(parameter, nested);
      for (const ref of nested.schemas) if (!includedSchemas.has(ref)) schemaQueue.push(ref);
      for (const ref of nested.parameters) if (!includedParameters.has(ref)) parameterQueue.push(ref);
    }
  }

  const schemas: JsonObject = {};
  for (const name of includedSchemas) schemas[name] = schemaSource[name];
  const parameters: JsonObject = {};
  for (const name of includedParameters) parameters[name] = parameterSource[name];

  const merged = {
    openapi: '3.0.0',
    info: {
      title: 'Asana (curated)',
      version: '1.0',
      description:
        'Curated subset (create/get/update a task) extracted from Asana’s real published OpenAPI document at ' +
        'github.com/Asana/openapi (defs/asana_oas.yaml). Every operation, parameter, and schema below is copied ' +
        'verbatim from the upstream 3MB document — only the transitive closure of schemas these 3 operations ' +
        'actually reference is included.',
    },
    servers: document.servers,
    paths,
    components: { schemas, parameters },
  };

  const { writeFileSync } = await import('node:fs');
  const path = await import('node:path');
  const outPath = path.resolve(process.cwd(), 'src/ingestion/sources/openapi/asana.json');
  writeFileSync(outPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
  console.log(
    `Wrote ${outPath} (${Object.keys(paths).length} paths, ${includedSchemas.size} schemas, ${includedParameters.size} parameters).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
