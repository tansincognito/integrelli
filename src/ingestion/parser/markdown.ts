import type { ExtractorKind } from '@/knowledge/capability';
import type { HttpMethod } from '@/knowledge/implementation';
import { inferSemanticType, type JsonSchemaNode } from '@/knowledge/schema';
import type { ProviderSeed } from '../sources';
import { LlmCapabilityDraftSchema, type CapabilityDraft, type DraftParameter, type LlmCapabilityDraft } from '../types';
import { inferSideEffects, snakeCase } from './openapi';

/**
 * Path B — documentation ingestion.
 *
 * Chunking and draft assembly are deterministic and shared; only the
 * *extraction* step inside a chunk is model-assisted (see llm-extractor.ts).
 * The heuristic extractor in this file handles the common
 * "heading + method line + parameter table" documentation shape and runs with
 * no network, which is what keeps `npm run ingest` and the test suite offline
 * (architecture.md section 5, Decision "Two extractors on the documentation path").
 */

export interface DocChunk {
  /** Level-2 heading text — one chunk is one candidate capability. */
  heading: string;
  /** Heading path used as the provenance pointer, e.g. `ElevenLabs API > Text to Speech`. */
  pointer: string;
  text: string;
}

const METHOD_LINE = /^\s*`?(GET|POST|PUT|PATCH|DELETE)\s+(\S+?)`?\s*$/im;

/** Splits a document into level-2 sections, keeping the level-1 title for the pointer. */
export function chunkMarkdown(content: string): DocChunk[] {
  const lines = content.split('\n');
  const documentTitle = lines.find((line) => line.startsWith('# '))?.slice(2).trim() ?? 'document';

  const chunks: DocChunk[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    if (heading === null) return;
    chunks.push({ heading, pointer: `${documentTitle} > ${heading}`, text: buffer.join('\n').trim() });
    buffer = [];
  };

  for (const line of lines) {
    if (line.startsWith('## ')) {
      flush();
      heading = line.slice(3).trim();
      continue;
    }
    if (heading !== null) buffer.push(line);
  }
  flush();

  return chunks.filter((chunk) => METHOD_LINE.test(chunk.text));
}

/**
 * Deterministic extractor for structured reference documentation. Returns null
 * when the chunk does not match the expected shape — the caller then decides
 * whether to fall back to the LLM extractor or record an issue.
 */
export function extractHeuristic(chunk: DocChunk): LlmCapabilityDraft | null {
  const methodMatch = METHOD_LINE.exec(chunk.text);
  if (!methodMatch) return null;

  const method = methodMatch[1].toUpperCase() as HttpMethod;
  const rawTarget = methodMatch[2];
  // Strip the origin textually rather than via `new URL`, which percent-encodes
  // the `{placeholder}` braces that path templates depend on.
  const path = rawTarget.replace(/^https?:\/\/[^/]+/, '');

  const sections = splitSections(chunk.text);

  const parameters: LlmCapabilityDraft['parameters'] = [
    ...readParameterTable(sections['request body'] ?? '', 'body'),
    ...readParameterTable(sections['query parameters'] ?? '', 'query'),
    ...readParameterTable(sections['path parameters'] ?? '', 'path'),
    ...readParameterTable(sections['headers'] ?? '', 'header'),
  ];

  for (const name of path.matchAll(/\{([^}]+)\}/g)) {
    if (!parameters.some((p) => p.name === name[1])) {
      parameters.push({ name: name[1], location: 'path', required: true, type: 'string' });
    }
  }

  const responseFields = readParameterTable(sections['response'] ?? '', 'body').map((field) => ({
    name: field.name,
    type: field.type,
    description: field.description,
  }));

  const auth = readAuthentication(sections['authentication'] ?? '');

  const candidate: LlmCapabilityDraft = {
    name: snakeCase(chunk.heading),
    description: readDescription(chunk.text) || chunk.heading,
    kind: /webhook|event/i.test(chunk.heading) ? 'event' : 'action',
    method: method as LlmCapabilityDraft['method'],
    path,
    parameters,
    response_fields: responseFields,
    authentication_kind: auth.kind,
    authentication_parameter_name: auth.parameter_name,
    permissions: readListSection(sections['permissions'] ?? sections['scopes'] ?? ''),
    side_effect_kind: inferSideEffects(method, path, chunk.heading).kind,
    side_effect_description: chunk.heading,
  };

  const parsed = LlmCapabilityDraftSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Turns an extraction (from either extractor) into a canonical draft. Transport
 * facts the extractor is not trusted with — base URL, protocol, credential env
 * var, provider-wide rate limits — come from the seed registry.
 */
export function draftFromExtraction(
  extraction: LlmCapabilityDraft,
  seed: ProviderSeed,
  pointer: string,
  extractor: ExtractorKind,
  extractionModel?: string
): CapabilityDraft {
  const parameters: DraftParameter[] = extraction.parameters.map((p) => ({
    name: p.name,
    location: p.location,
    required: p.required,
    type: p.type,
    description: p.description,
  }));

  const bodyParameters = parameters.filter((p) => p.location === 'body');
  const requestSchema = bodyParameters.length > 0 ? schemaFromFields(bodyParameters) : null;
  const responseSchema =
    extraction.response_fields.length > 0
      ? schemaFromFields(
          extraction.response_fields.map((f) => ({
            name: f.name,
            location: 'body' as const,
            required: false,
            type: f.type,
            description: f.description,
          }))
        )
      : null;

  return {
    provider_id: seed.id,
    api_version: seed.version,
    kind: extraction.kind,
    name: extraction.name,
    description: extraction.description,
    protocol: extraction.kind === 'event' ? 'webhook' : 'rest',
    method: extraction.method,
    endpoint: `${seed.base_url ?? ''}${extraction.path}`,
    path_parameters: [...extraction.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]),
    headers: requestSchema ? { 'Content-Type': 'application/json' } : {},
    request_content_type: requestSchema ? 'application/json' : undefined,
    parameters: parameters.filter((p) => p.location !== 'body'),
    request_schema: requestSchema,
    response_schema: responseSchema,
    authentication: {
      kind: extraction.authentication_kind,
      parameter_name: extraction.authentication_parameter_name,
      env_var_name: seed.credential_env_var,
    },
    permissions: extraction.permissions,
    rate_limits: seed.rate_limits,
    idempotency: seed.idempotency,
    side_effects: {
      kind: extraction.side_effect_kind,
      description: extraction.side_effect_description,
      reversible: extraction.side_effect_kind === 'read' || extraction.side_effect_kind === 'update',
    },
    source_pointer: pointer,
    extractor,
    extraction_model: extractionModel,
  };
}

/**
 * Builds a request/response schema from flat documentation rows. Dotted names
 * (`properties.email`, as HubSpot's contact docs write them) become real nested
 * objects rather than a literal key with a dot in it, so the schema is usable
 * for request construction and the flattened path still reads `properties.email`.
 */
function schemaFromFields(fields: DraftParameter[]): JsonSchemaNode {
  const root: JsonSchemaNode = { type: 'object', properties: {}, required: [] };

  for (const field of fields) {
    const segments = field.name.split('.').filter(Boolean);
    const leaf = segments[segments.length - 1];
    let node = root;

    for (const segment of segments.slice(0, -1)) {
      const container = node.properties ?? (node.properties = {});
      const existing = container[segment];
      const child: JsonSchemaNode =
        existing && existing.type === 'object' ? existing : { type: 'object', properties: {}, required: [] };
      child.properties = child.properties ?? {};
      child.required = child.required ?? [];
      container[segment] = child;
      node = child;
    }

    (node.properties ?? (node.properties = {}))[leaf] = {
      type: field.type,
      description: field.description,
      format: inferSemanticType(leaf, field.type) === 'email' ? 'email' : undefined,
    };
    if (field.required) (node.required ?? (node.required = [])).push(leaf);
  }

  return root;
}

/* --------------------------------------------------------- markdown bits -- */

/** Maps lowercased level-3 heading text to that subsection's body. */
function splitSections(text: string): Record<string, string> {
  const sections: Record<string, string> = {};
  let current: string | null = null;
  let buffer: string[] = [];

  for (const line of text.split('\n')) {
    if (line.startsWith('### ')) {
      if (current) sections[current] = buffer.join('\n');
      current = line.slice(4).trim().toLowerCase();
      buffer = [];
      continue;
    }
    if (current) buffer.push(line);
  }
  if (current) sections[current] = buffer.join('\n');
  return sections;
}

/** First prose paragraph of the chunk — the text before any subsection or table. */
function readDescription(text: string): string {
  for (const block of text.split(/\n\s*\n/)) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('|') || METHOD_LINE.test(trimmed)) continue;
    return trimmed.replace(/\n/g, ' ');
  }
  return '';
}

const TYPE_WORDS = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array']);

/** Reads a `| field | type | required | description |` markdown table. */
function readParameterTable(section: string, defaultLocation: DraftParameter['location']): LlmCapabilityDraft['parameters'] {
  const rows = section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'));

  if (rows.length < 2) return [];

  const header = splitRow(rows[0]).map((cell) => cell.toLowerCase());
  const columnOf = (...names: string[]): number => header.findIndex((cell) => names.includes(cell));

  const nameColumn = columnOf('field', 'name', 'parameter');
  const typeColumn = columnOf('type');
  const requiredColumn = columnOf('required');
  const locationColumn = columnOf('in', 'location');
  const descriptionColumn = columnOf('description');
  if (nameColumn === -1) return [];

  return rows
    .slice(1)
    .filter((row) => !/^\|[\s|:-]+\|$/.test(row))
    .map((row) => {
      const cells = splitRow(row);
      const rawType = (cells[typeColumn] ?? 'string').toLowerCase().replace(/[^a-z]/g, '');
      const rawLocation = (cells[locationColumn] ?? defaultLocation).toLowerCase();
      const location = ['body', 'query', 'path', 'header'].includes(rawLocation)
        ? (rawLocation as DraftParameter['location'])
        : defaultLocation;

      return {
        name: (cells[nameColumn] ?? '').replace(/`/g, '').trim(),
        location,
        required: /yes|true|required/i.test(cells[requiredColumn] ?? ''),
        type: (TYPE_WORDS.has(rawType) ? rawType : 'string') as DraftParameter['type'],
        description: cells[descriptionColumn]?.trim() || undefined,
      };
    })
    .filter((parameter) => parameter.name.length > 0);
}

function splitRow(row: string): string[] {
  return row.slice(1, -1).split('|').map((cell) => cell.trim());
}

function readListSection(section: string): string[] {
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).replace(/`/g, '').trim())
    .filter(Boolean);
}

function readAuthentication(section: string): {
  kind: LlmCapabilityDraft['authentication_kind'];
  parameter_name?: string;
} {
  const text = section.toLowerCase();
  const headerMatch = /header\s+`([^`]+)`/i.exec(section);

  if (/bearer/.test(text)) return { kind: 'bearer', parameter_name: 'Authorization' };
  if (/oauth/.test(text)) return { kind: 'oauth2' };
  if (headerMatch) return { kind: 'header', parameter_name: headerMatch[1] };
  if (/query parameter/.test(text)) return { kind: 'query' };
  return { kind: 'bearer' };
}
