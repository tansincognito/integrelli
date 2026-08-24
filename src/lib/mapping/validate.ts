import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { JsonSchema, JsonValue } from '@/types/endpoint';
import type { PlanIssue } from '@/types/workflow';

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

// Compiled validators are cheap to build but there is no reason to recompile
// the same schema object on every call within a run.
const compiledCache = new WeakMap<object, ValidateFunction>();

function compile(schema: JsonSchema): ValidateFunction {
  const cached = compiledCache.get(schema);
  if (cached) return cached;
  const validateFn = ajv.compile(schema as object);
  compiledCache.set(schema, validateFn);
  return validateFn;
}

/** Validate `value` against `schema`, returning `schema_violation` PlanIssues (empty if valid). */
export function validateAgainstSchema(
  schema: JsonSchema,
  value: JsonValue,
  opts?: { stepId?: string }
): PlanIssue[] {
  const validateFn = compile(schema);
  const valid = validateFn(value);
  if (valid) return [];

  return (validateFn.errors ?? []).map((err) => ({
    severity: 'error',
    stepId: opts?.stepId,
    path: err.instancePath || err.schemaPath,
    code: 'schema_violation',
    message: `${err.instancePath || '(root)'} ${err.message ?? 'is invalid'}`,
  }));
}

/** Convenience wrapper for a composed request body vs. `endpoint.requestSchema`. */
export function validateRequestBody(
  requestSchema: JsonSchema | null,
  body: JsonValue | null,
  opts?: { stepId?: string }
): PlanIssue[] {
  if (requestSchema === null) return [];
  return validateAgainstSchema(requestSchema, body ?? {}, opts);
}
