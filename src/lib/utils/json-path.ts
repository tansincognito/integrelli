import type { JsonValue } from '@/types/endpoint';

/**
 * Get/set values on plain JSON objects by dotted path with `[n]` array
 * index support, e.g. "line_items[0].price" or "a.b[2].c".
 * Pure, no dependencies.
 */

type Segment = { key: string } | { index: number };

/** Parse "a.b[0].c" -> [{key:'a'},{key:'b'},{index:0},{key:'c'}] */
export function parsePath(path: string): Segment[] {
  if (path.length === 0) return [];
  const segments: Segment[] = [];
  const parts = path.split('.');
  for (const part of parts) {
    if (part.length === 0) continue;
    const re = /([^[\]]+)|\[(\d+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(part)) !== null) {
      if (match[1] !== undefined) {
        segments.push({ key: match[1] });
      } else if (match[2] !== undefined) {
        segments.push({ index: Number(match[2]) });
      }
    }
  }
  return segments;
}

/** Read a value at `path` from `obj`. Returns undefined if any segment is missing. */
export function getByPath(obj: JsonValue | undefined, path: string): JsonValue | undefined {
  const segments = parsePath(path);
  let current: JsonValue | undefined = obj;
  for (const segment of segments) {
    if (current === undefined || current === null || typeof current !== 'object') {
      return undefined;
    }
    if ('index' in segment) {
      if (!Array.isArray(current)) return undefined;
      current = current[segment.index];
    } else {
      if (Array.isArray(current)) return undefined;
      current = (current as { [k: string]: JsonValue })[segment.key];
    }
  }
  return current;
}

/**
 * Set a value at `path` within `obj`, creating intermediate objects/arrays
 * as needed. Mutates and returns `obj`. If `obj` is undefined, a new root
 * object or array is created based on the first path segment.
 */
export function setByPath(
  obj: JsonValue | undefined,
  path: string,
  value: JsonValue
): JsonValue {
  const segments = parsePath(path);
  if (segments.length === 0) return value;

  const root: JsonValue = obj !== undefined && obj !== null
    ? obj
    : 'index' in segments[0] ? [] : {};

  let current: JsonValue = root;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;
    const nextSegment = segments[i + 1];

    if ('index' in segment) {
      if (!Array.isArray(current)) {
        throw new TypeError(`setByPath: expected array at segment ${i} of "${path}"`);
      }
      if (isLast) {
        current[segment.index] = value;
      } else {
        const existing = current[segment.index];
        const needsArray = nextSegment !== undefined && 'index' in nextSegment;
        if (existing === undefined || existing === null || typeof existing !== 'object') {
          current[segment.index] = needsArray ? [] : {};
        }
        current = current[segment.index] as JsonValue;
      }
    } else {
      if (Array.isArray(current) || typeof current !== 'object' || current === null) {
        throw new TypeError(`setByPath: expected object at segment ${i} of "${path}"`);
      }
      const container = current as { [k: string]: JsonValue };
      if (isLast) {
        container[segment.key] = value;
      } else {
        const existing = container[segment.key];
        const needsArray = nextSegment !== undefined && 'index' in nextSegment;
        if (existing === undefined || existing === null || typeof existing !== 'object') {
          container[segment.key] = needsArray ? [] : {};
        }
        current = container[segment.key] as JsonValue;
      }
    }
  }

  return root;
}
