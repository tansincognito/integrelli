/**
 * Schema layer of the canonical model.
 *
 * Everything the capability graph knows about the *shape* of data lives here:
 * a permissive JSON Schema node type, a flattener that turns a schema into a
 * flat list of dotted field paths, deterministic semantic-type inference, and
 * a compatibility check used by the planner validator.
 *
 * Naming note: canonical-model records use snake_case because they are a
 * persisted wire format (see architecture.md, Decision "Model field naming").
 * Pure helpers like the ones in this file stay camelCase like the rest of the
 * TypeScript in this repo.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue };

export type JsonType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

/**
 * JSON Schema subset we persist. Deliberately permissive: ingested upstream
 * specs contain keywords we do not model, and dropping them silently is worse
 * than carrying them through untouched.
 */
export interface JsonSchemaNode {
  type?: JsonType;
  title?: string;
  description?: string;
  format?: string;
  enum?: JsonPrimitive[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  additionalProperties?: boolean | JsonSchemaNode;
  example?: JsonValue;
  default?: JsonValue;
  nullable?: boolean;
  minimum?: number;
  maximum?: number;
  /** Preserved verbatim for keywords we do not model. */
  [k: string]: unknown;
}

/**
 * A semantic type is a *meaning* label, not a JSON type. Two fields with
 * semantic type `email` can be wired together by the planner even if one is
 * called `customer_email` and the other `to`. Inference is deterministic —
 * name and format only, never an LLM call.
 */
export type SemanticType =
  | 'email'
  | 'url'
  | 'phone'
  | 'currency_amount'
  | 'currency_code'
  | 'identifier'
  | 'timestamp'
  | 'boolean_flag'
  | 'html'
  | 'text'
  | 'json';

/** One leaf (or container) field of a schema, addressed by dotted path. */
export interface SchemaField {
  /** Dotted path from the schema root, `[]` marks an array hop: `data.items[].id`. */
  path: string;
  /** Last path segment, convenient for name-based matching. */
  name: string;
  type: JsonType;
  required: boolean;
  description?: string;
  format?: string;
  enum?: JsonPrimitive[];
  semantic_type: SemanticType;
}

const EMAIL_HINTS = ['email', 'mail', 'recipient'];
const URL_HINTS = ['url', 'uri', 'link', 'href', 'webhook', 'permalink'];
const PHONE_HINTS = ['phone', 'msisdn', 'phonenumber'];
const AMOUNT_HINTS = ['amount', 'price', 'total', 'subtotal', 'cents'];
const CURRENCY_HINTS = ['currency'];
const ID_HINTS = ['id', 'ids', 'sid', 'uuid', 'key', 'reference', 'channel', 'ts'];
const TIME_HINTS = ['at', 'time', 'timestamp', 'date', 'created', 'updated', 'expires'];
const HTML_HINTS = ['html', 'richtext'];

/**
 * Segment-wise hint matching. A substring test is too eager — `status`
 * contains `at`, and `latest_charge` contains it twice — so the name is split
 * on both snake_case and camelCase boundaries and each segment is compared
 * whole.
 */
function nameMatches(name: string, hints: string[]): boolean {
  const segments = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  return hints.some((hint) => segments.includes(hint));
}

/**
 * Deterministic semantic-type inference from a field's name, JSON type and
 * JSON Schema `format`. Format wins over name because it is machine-authored;
 * name hints only break ties.
 */
export function inferSemanticType(name: string, type: JsonType, format?: string): SemanticType {
  if (format === 'email') return 'email';
  if (format === 'uri' || format === 'url') return 'url';
  if (format === 'date-time' || format === 'date') return 'timestamp';
  if (format === 'uuid') return 'identifier';

  if (type === 'boolean') return 'boolean_flag';
  if (type === 'object' || type === 'array') return 'json';

  if (nameMatches(name, EMAIL_HINTS)) return 'email';
  if (nameMatches(name, URL_HINTS)) return 'url';
  if (nameMatches(name, PHONE_HINTS)) return 'phone';
  if (nameMatches(name, CURRENCY_HINTS)) return 'currency_code';
  if ((type === 'number' || type === 'integer') && nameMatches(name, AMOUNT_HINTS)) return 'currency_amount';
  if ((type === 'number' || type === 'integer') && nameMatches(name, TIME_HINTS)) return 'timestamp';
  if (nameMatches(name, TIME_HINTS) && type === 'string') return 'timestamp';
  if (nameMatches(name, HTML_HINTS)) return 'html';
  if (nameMatches(name, ID_HINTS)) return 'identifier';

  return type === 'string' ? 'text' : 'json';
}

/** Normalizes a possibly-missing/union `type` down to our single-type enum. */
export function normalizeJsonType(raw: unknown, node?: JsonSchemaNode): JsonType {
  const candidate = Array.isArray(raw) ? raw.find((t) => t !== 'null') : raw;
  if (
    candidate === 'object' || candidate === 'array' || candidate === 'string' ||
    candidate === 'number' || candidate === 'integer' || candidate === 'boolean' || candidate === 'null'
  ) {
    return candidate;
  }
  if (node?.properties) return 'object';
  if (node?.items) return 'array';
  if (node?.enum && node.enum.length > 0) return typeof node.enum[0] === 'number' ? 'number' : 'string';
  return 'string';
}

const MAX_FLATTEN_DEPTH = 4;

/**
 * Flattens a schema into dotted field paths. Containers are emitted *and*
 * descended into, because a mapping may legitimately target a whole object
 * (`personalizations[].to`) or one leaf (`amount`).
 *
 * Depth is capped: upstream specs (Stripe especially) contain deeply nested
 * objects whose tail is never a useful mapping target, and an uncapped walk
 * blows up both the planner prompt and the embedding document.
 */
export function flattenSchema(
  schema: JsonSchemaNode | null | undefined,
  options: { prefix?: string; depth?: number } = {}
): SchemaField[] {
  if (!schema) return [];
  const prefix = options.prefix ?? '';
  const depth = options.depth ?? 0;
  if (depth > MAX_FLATTEN_DEPTH) return [];

  const fields: SchemaField[] = [];
  const requiredSet = new Set(schema.required ?? []);

  if (schema.properties) {
    for (const [name, child] of Object.entries(schema.properties)) {
      const path = prefix ? `${prefix}.${name}` : name;
      const type = normalizeJsonType(child.type, child);
      const format = typeof child.format === 'string' ? child.format : undefined;

      fields.push({
        path,
        name,
        type,
        required: requiredSet.has(name),
        description: child.description,
        format,
        enum: child.enum,
        semantic_type: inferSemanticType(name, type, format),
      });

      if (type === 'object') {
        fields.push(...flattenSchema(child, { prefix: path, depth: depth + 1 }));
      } else if (type === 'array' && child.items) {
        fields.push(...flattenSchema(child.items, { prefix: `${path}[]`, depth: depth + 1 }));
      }
    }
  }

  return fields;
}

/** Looks up one dotted path in a flattened field list. */
export function findField(fields: SchemaField[], path: string): SchemaField | undefined {
  return fields.find((f) => f.path === path);
}

export interface CompatibilityResult {
  compatible: boolean;
  /** 'exact' semantic match, 'coercible' JSON-type match, or the failure reason. */
  reason: 'exact' | 'coercible' | 'semantic_mismatch' | 'type_mismatch';
}

const COERCIBLE: Record<JsonType, JsonType[]> = {
  string: ['string'],
  number: ['number', 'integer', 'string'],
  integer: ['integer', 'number', 'string'],
  boolean: ['boolean', 'string'],
  object: ['object'],
  array: ['array'],
  null: ['null'],
};

/**
 * Can a value produced by `source` be written into `destination`?
 *
 * Semantic type is checked first (an `email` must not land in a `phone`
 * field even though both are strings); JSON type is the fallback. `text`,
 * `json` and `identifier` are treated as permissive sinks — real APIs
 * routinely accept an id or a free-text blob where anything stringy fits.
 */
export function isCompatible(source: SchemaField, destination: SchemaField): CompatibilityResult {
  const permissiveSink = destination.semantic_type === 'text' || destination.semantic_type === 'json';

  if (source.semantic_type === destination.semantic_type) return { compatible: true, reason: 'exact' };

  const strictSemantic: SemanticType[] = ['email', 'phone', 'url', 'currency_code'];
  if (
    strictSemantic.includes(destination.semantic_type) &&
    source.semantic_type !== destination.semantic_type &&
    source.semantic_type !== 'text'
  ) {
    return { compatible: false, reason: 'semantic_mismatch' };
  }

  const allowed = COERCIBLE[destination.type] ?? [];
  if (permissiveSink || allowed.includes(source.type)) {
    return { compatible: true, reason: 'coercible' };
  }
  return { compatible: false, reason: 'type_mismatch' };
}
