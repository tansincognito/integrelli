import type { JsonValue } from '@/types/endpoint';
import type { ExecutionMode, PreparedRequest } from '@/types/execution';
import type { HttpAdapter, RawHttpResponse } from '@/lib/exec/adapter';
import { getByPath } from '@/lib/utils/json-path';
import type { DriftScenario } from './types';

function isRecord(value: JsonValue | null | undefined): value is { [k: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function splitParent(path: string): { parentPath: string; key: string } {
  const idx = path.lastIndexOf('.');
  return idx === -1 ? { parentPath: '', key: path } : { parentPath: path.slice(0, idx), key: path.slice(idx + 1) };
}

/** Renames the object key at `path`'s last segment to `renameTo`, leaving the value untouched. */
function renameField(body: JsonValue, path: string, renameTo: string): JsonValue {
  const { parentPath, key } = splitParent(path);
  const parent = parentPath ? getByPath(body, parentPath) : body;
  if (!isRecord(parent) || !(key in parent)) return body;

  const cloned = structuredClone(body);
  const clonedParent = (parentPath ? getByPath(cloned, parentPath) : cloned) as { [k: string]: JsonValue };
  clonedParent[renameTo] = clonedParent[key];
  delete clonedParent[key];
  return cloned;
}

function coerce(value: JsonValue, toType: 'string' | 'number' | 'boolean'): JsonValue {
  switch (toType) {
    case 'string':
      return typeof value === 'string' ? value : JSON.stringify(value);
    case 'number': {
      const n = Number(value);
      return Number.isNaN(n) ? 0 : n;
    }
    case 'boolean':
      return Boolean(value);
  }
}

function setField(body: JsonValue, path: string, value: JsonValue): JsonValue {
  const { parentPath, key } = splitParent(path);
  const parent = parentPath ? getByPath(body, parentPath) : body;
  if (!isRecord(parent)) return body;

  const cloned = structuredClone(body);
  const clonedParent = (parentPath ? getByPath(cloned, parentPath) : cloned) as { [k: string]: JsonValue };
  clonedParent[key] = value;
  return cloned;
}

/** Applies one `DriftScenario` to a base response, or returns it unchanged if the scenario can't apply. */
export function applyDrift(raw: RawHttpResponse, scenario: DriftScenario): RawHttpResponse {
  switch (scenario.class) {
    case 'expired_token':
      return {
        ...raw,
        status: 401,
        body: { error: { type: 'authentication_error', message: 'Access token expired or revoked.' } },
      };
    case 'removed_endpoint':
      return {
        ...raw,
        status: 404,
        body: { error: { type: 'not_found', message: 'This endpoint no longer exists.' } },
      };
    case 'renamed_field': {
      if (!scenario.field || !scenario.renameTo || raw.body === null) return raw;
      return { ...raw, body: renameField(raw.body, scenario.field, scenario.renameTo) };
    }
    case 'type_change': {
      if (!scenario.field || !scenario.forceType || raw.body === null) return raw;
      const current = getByPath(raw.body, scenario.field);
      if (current === undefined) return raw;
      return { ...raw, body: setField(raw.body, scenario.field, coerce(current, scenario.forceType)) };
    }
    case 'new_enum_value': {
      if (!scenario.field || scenario.enumValue === undefined || raw.body === null) return raw;
      return { ...raw, body: setField(raw.body, scenario.field, scenario.enumValue) };
    }
  }
}

/**
 * Wraps a real adapter (MockAdapter today, LiveAdapter later via a real
 * drift-injector proxy) and mutates the response for whichever step a
 * scenario targets — same "decorator around HttpAdapter" seam the existing
 * fault-injection panel already uses for 429/500s (mock-adapter.ts), just
 * one layer further out so it never needs to know about faults at all.
 */
export class DriftInjectorAdapter implements HttpAdapter {
  readonly mode: ExecutionMode;

  constructor(
    private readonly base: HttpAdapter,
    private readonly scenarios: DriftScenario[]
  ) {
    this.mode = base.mode;
  }

  async send(req: PreparedRequest, ctx: { stepId: string; attempt: number; seed: string }): Promise<RawHttpResponse> {
    const raw = await this.base.send(req, ctx);
    const scenario = this.scenarios.find((s) => s.stepId === ctx.stepId);
    return scenario ? applyDrift(raw, scenario) : raw;
  }
}
