import type { JsonSchema, JsonValue } from '@/types/endpoint';
import { hashString, mulberry32 } from './rng';

/**
 * Deterministic JSON-Schema -> mock value generator.
 *
 * Every field gets its own RNG seeded from `${seedBase}|${schemaPath}`
 * (plus a small suffix for sub-decisions like array length or optional
 * inclusion), per DESIGN.md section 6. This is what makes per-field values
 * independent of step order/position: `seedBase` already carries
 * `runSeed|stepId|attempt`, and `schemaPath` never encodes a step index.
 */

const OPTIONAL_INCLUDE_THRESHOLD = 0.35;
const MIN_ARRAY_LEN = 1;
const MAX_ARRAY_LEN = 3;
const DATE_EPOCH_BASE_SECONDS = 1_700_000_000;
const DATE_JITTER_SECONDS = 100_000;

function rngFor(seedBase: string, schemaPath: string, suffix?: string): () => number {
  const key = suffix ? `${seedBase}|${schemaPath}|${suffix}` : `${seedBase}|${schemaPath}`;
  return mulberry32(hashString(key));
}

function tokenFor(seedBase: string, schemaPath: string, suffix?: string): string {
  const rng = rngFor(seedBase, schemaPath, suffix ? `${suffix}|token` : 'token');
  return Math.floor(rng() * 1e8).toString(36);
}

function lastSegment(schemaPath: string): string {
  const parts = schemaPath.split('.');
  const last = parts[parts.length - 1] ?? schemaPath;
  const cleaned = last.replace(/\[\d+\]$/, '');
  return cleaned.length > 0 ? cleaned : 'field';
}

function generateUuid(rng: () => number): string {
  const hex = () => Math.floor(rng() * 16).toString(16);
  const seg = (n: number) => Array.from({ length: n }, hex).join('');
  return `${seg(8)}-${seg(4)}-4${seg(3)}-a${seg(3)}-${seg(12)}`;
}

function generateMockString(
  schema: JsonSchema,
  rng: () => number,
  seedBase: string,
  schemaPath: string
): string {
  switch (schema.format) {
    case 'email':
      return `user${Math.floor(rng() * 10000)}@example.com`;
    case 'uri':
      return `https://example.com/${tokenFor(seedBase, schemaPath, 'uri')}`;
    case 'date-time': {
      const offset = Math.floor(rng() * DATE_JITTER_SECONDS);
      return new Date((DATE_EPOCH_BASE_SECONDS + offset) * 1000).toISOString();
    }
    case 'uuid':
      return generateUuid(rng);
    default:
      return `${lastSegment(schemaPath)}_${tokenFor(seedBase, schemaPath, 'str')}`;
  }
}

/** Generate a deterministic mock value for `schema`, rooted at `schemaPath`. */
export function generateMockValue(schema: JsonSchema, seedBase: string, schemaPath: string): JsonValue {
  if (schema.example !== undefined) {
    return schema.example;
  }

  if (schema.enum && schema.enum.length > 0) {
    const rng = rngFor(seedBase, schemaPath, 'enum');
    const idx = Math.floor(rng() * schema.enum.length);
    return schema.enum[idx];
  }

  const rng = rngFor(seedBase, schemaPath);

  switch (schema.type) {
    case 'object': {
      const out: { [k: string]: JsonValue } = {};
      const required = new Set(schema.required ?? []);
      const properties = schema.properties ?? {};
      for (const [key, propSchema] of Object.entries(properties)) {
        const childPath = `${schemaPath}.${key}`;
        if (required.has(key)) {
          out[key] = generateMockValue(propSchema, seedBase, childPath);
          continue;
        }
        const includeRng = rngFor(seedBase, childPath, 'include');
        if (includeRng() > OPTIONAL_INCLUDE_THRESHOLD) {
          out[key] = generateMockValue(propSchema, seedBase, childPath);
        }
      }
      return out;
    }

    case 'array': {
      const itemSchema: JsonSchema = schema.items ?? { type: 'string' };
      const lenRng = rngFor(seedBase, schemaPath, 'length');
      const len = MIN_ARRAY_LEN + Math.floor(lenRng() * (MAX_ARRAY_LEN - MIN_ARRAY_LEN + 1));
      const items: JsonValue[] = [];
      for (let i = 0; i < len; i++) {
        items.push(generateMockValue(itemSchema, seedBase, `${schemaPath}[${i}]`));
      }
      return items;
    }

    case 'string':
      return generateMockString(schema, rng, seedBase, schemaPath);

    case 'number': {
      const min = schema.minimum ?? 0;
      const max = schema.maximum ?? min + 1000;
      return Math.round((min + rng() * (max - min)) * 100) / 100;
    }

    case 'integer': {
      const min = schema.minimum ?? 0;
      const max = schema.maximum ?? min + 1000;
      return Math.floor(min + rng() * (max - min));
    }

    case 'boolean':
      return rng() > 0.5;

    case 'null':
      return null;

    default:
      // Untyped schema node: fall back to a generic deterministic string.
      return `${lastSegment(schemaPath)}_${tokenFor(seedBase, schemaPath, 'untyped')}`;
  }
}

function isJsonObject(value: JsonValue): value is { [k: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Generate a mock response body: schema-driven generation first, then
 * (for object schemas) fill in any keys the schema left out from
 * `exampleResponse` — this is the "merge over exampleResponse for thin
 * schemas" behavior from DESIGN.md section 6, point 4.
 */
export function generateMockResponseBody(
  schema: JsonSchema,
  exampleResponse: JsonValue,
  seedBase: string
): JsonValue {
  const generated = generateMockValue(schema, seedBase, 'response');
  if (schema.type === 'object' && isJsonObject(generated) && isJsonObject(exampleResponse)) {
    return { ...exampleResponse, ...generated };
  }
  return generated;
}
