import type { JsonValue } from '@/types/endpoint';
import type { Attempt, StepResult } from '@/types/execution';

/**
 * Belt-and-braces sweep: strip any `process.env` value substring from
 * anything entering the trace. The primary defense is that secrets are
 * never resolved outside `live-adapter.send` in the first place (values in
 * PreparedRequest stay `<ENV_VAR>` placeholders) — this is the backstop for
 * live-mode response bodies/headers that might echo a secret back.
 */

const MIN_SECRET_LENGTH = 6;
const REDACTED = '[REDACTED]';

export function collectSecretValues(env: NodeJS.ProcessEnv = process.env): string[] {
  const values: string[] = [];
  for (const value of Object.values(env)) {
    if (typeof value === 'string' && value.length >= MIN_SECRET_LENGTH) {
      values.push(value);
    }
  }
  // Longest first so a secret that is a substring of a longer one doesn't
  // leave a partial match behind.
  return values.sort((a, b) => b.length - a.length);
}

function redactString(value: string, secrets: string[]): string {
  let result = value;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    if (result.includes(secret)) {
      result = result.split(secret).join(REDACTED);
    }
  }
  return result;
}

export function redactJsonValue(value: JsonValue, secrets: string[]): JsonValue {
  if (secrets.length === 0) return value;
  if (typeof value === 'string') return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactJsonValue(item, secrets));
  if (value !== null && typeof value === 'object') {
    const out: { [k: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactJsonValue(v, secrets);
    return out;
  }
  return value;
}

function redactRecord(record: Record<string, string>, secrets: string[]): Record<string, string> {
  if (secrets.length === 0) return record;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) out[k] = redactString(v, secrets);
  return out;
}

function redactAttempt(attempt: Attempt, secrets: string[]): Attempt {
  if (secrets.length === 0) return attempt;
  return {
    ...attempt,
    responseBody: attempt.responseBody === null ? null : redactJsonValue(attempt.responseBody, secrets),
    responseHeaders: redactRecord(attempt.responseHeaders, secrets),
    error: attempt.error ? { ...attempt.error, message: redactString(attempt.error.message, secrets) } : undefined,
  };
}

/** Redact every string reachable from a StepResult before it is stored in a trace. */
export function redactStepResult(step: StepResult, secrets: string[] = collectSecretValues()): StepResult {
  if (secrets.length === 0) return step;
  return {
    ...step,
    request: {
      ...step.request,
      headers: redactRecord(step.request.headers, secrets),
      query: redactRecord(step.request.query, secrets),
      body: step.request.body === null ? null : redactJsonValue(step.request.body, secrets),
    },
    attempts: step.attempts.map((attempt) => redactAttempt(attempt, secrets)),
    responseBody: step.responseBody === null ? null : redactJsonValue(step.responseBody, secrets),
  };
}
