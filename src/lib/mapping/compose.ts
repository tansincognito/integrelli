import type { JsonValue } from '@/types/endpoint';
import type { FieldMapping } from '@/types/workflow';
import { setByPath } from '@/lib/utils/json-path';

/** One mapping paired with the concrete value it resolved to (see resolve.ts). */
export interface ResolvedMapping {
  mapping: FieldMapping;
  value: JsonValue;
}

export interface ComposedRequest {
  headers: Record<string, string>;
  query: Record<string, string>;
  /** Path param name -> value (already stringified, keyed by ParamSpec.name / ":name" template). */
  path: Record<string, string>;
  body: JsonValue | null;
}

function toFlatValue(value: JsonValue): string {
  if (typeof value === 'string') return value;
  if (value === null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * Turn a flat, resolved `FieldMapping[]` into the nested shape the engine
 * needs: a dotted-path-composed `body`, and flat key/value maps for
 * headers/query/path (those targets are conventionally flat on real APIs).
 */
export function composeRequest(resolved: ResolvedMapping[]): ComposedRequest {
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  const path: Record<string, string> = {};
  let body: JsonValue | null = null;

  for (const { mapping, value } of resolved) {
    switch (mapping.target) {
      case 'header':
        headers[mapping.path] = toFlatValue(value);
        break;
      case 'query':
        query[mapping.path] = toFlatValue(value);
        break;
      case 'path':
        path[mapping.path] = toFlatValue(value);
        break;
      case 'body':
        body = setByPath(body ?? {}, mapping.path, value);
        break;
      default: {
        const exhaustive: never = mapping.target;
        throw new Error(`Unknown mapping target: ${String(exhaustive)}`);
      }
    }
  }

  return { headers, query, path, body };
}
