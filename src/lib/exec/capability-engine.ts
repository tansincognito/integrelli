import type { JsonSchema, JsonValue } from '@/types/endpoint';
import type { Attempt, ExecutionTrace, FaultInjection, PreparedRequest, StepResult, StepStatus } from '@/types/execution';
import type { PlanIssue } from '@/types/workflow';
import type { Capability, CapabilityAuthentication, InputLocation } from '@/knowledge/capability';
import type { Implementation } from '@/knowledge/implementation';
import { loadStore } from '@/knowledge/store';
import type { TransformName, WorkflowPlan } from '@/planner/schema';
import type { PlanValidation, ResolvedMapping } from '@/planner/validator';
import { getByPath, setByPath } from '@/lib/utils/json-path';
import { hashString, seededRng } from './rng';
import { redactStepResult } from './redact';
import { shouldRetry, computeBackoffMs, getRetryAfterSeconds, parseRateLimitHeaders } from './retry';
import { MockAdapter, getFaultForStep, isFaultAttempt } from './mock-adapter';

/**
 * Execution engine for the ingested capability graph (`src/generated/capability-store.json`),
 * parallel to `engine.ts`'s `runWorkflow` which only knows the hand-authored
 * `EndpointSpec` pack. Mock/test mode only — live mode for this graph is a
 * separate piece of work (see plan doc); a `mode: 'live'` request is rejected
 * by the route before this module is ever reached.
 *
 * Reuses `validatePlan`'s `resolved_mappings` (source/destination already
 * resolved to concrete step+field or a literal, type-checked) instead of
 * re-deriving reference resolution the way the old pack's `resolve.ts` does.
 */

export interface CapabilityRunOptions {
  seed: string;
  faults: FaultInjection[];
}

function toFlatValue(value: JsonValue): string {
  if (typeof value === 'string') return value;
  if (value === null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** `{name}` placeholders, as used by ingested `Implementation.endpoint` (vs. the old pack's `:name`). */
function substituteBraceParams(template: string, params: Record<string, string>): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) =>
    params[name] !== undefined ? params[name] : match
  );
}

function buildAuthHeaders(auth: CapabilityAuthentication): { headers: Record<string, string>; query: Record<string, string> } {
  switch (auth.kind) {
    case 'bearer':
      return auth.env_var_name ? { headers: { Authorization: `Bearer <${auth.env_var_name}>` }, query: {} } : { headers: {}, query: {} };
    case 'header':
      return auth.parameter_name && auth.env_var_name
        ? { headers: { [auth.parameter_name]: `<${auth.env_var_name}>` }, query: {} }
        : { headers: {}, query: {} };
    case 'basic':
      return auth.env_var_name ? { headers: { Authorization: `Basic <${auth.env_var_name}>` }, query: {} } : { headers: {}, query: {} };
    case 'query':
      return auth.parameter_name && auth.env_var_name
        ? { headers: {}, query: { [auth.parameter_name]: `<${auth.env_var_name}>` } }
        : { headers: {}, query: {} };
    case 'oauth2':
    case 'none':
      return { headers: {}, query: {} };
    default: {
      const exhaustive: never = auth.kind;
      throw new Error(`Unknown auth kind: ${String(exhaustive)}`);
    }
  }
}

/** Base64url-encodes the resolved value. `rfc822_base64url` assumes the source already
 *  carries fully-composed RFC 2822 text (headers + body) — the mapping grammar is one
 *  source field to one destination field, so composing multi-part messages is the plan
 *  author's job (typically a `literal:` mapping), not the transform's. */
function applyTransform(transform: TransformName | undefined, value: JsonValue): JsonValue {
  switch (transform) {
    case undefined:
    case 'identity':
      return value;
    case 'to_string':
      return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
    case 'json_stringify':
      return JSON.stringify(value);
    case 'to_minor_units': {
      const n = typeof value === 'number' ? value : Number(value);
      return Math.round(n * 100);
    }
    case 'rfc822_base64url': {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      return Buffer.from(text, 'utf-8').toString('base64url');
    }
    default: {
      const exhaustive: never = transform;
      throw new Error(`Unknown transform: ${String(exhaustive)}`);
    }
  }
}

interface ResolvedField {
  path: string;
  location: InputLocation;
  value: JsonValue;
}

function computeTraceStatus(steps: StepResult[]): ExecutionTrace['status'] {
  if (steps.length === 0) return 'failed';
  const successCount = steps.filter((s) => s.status === 'success').length;
  if (successCount === steps.length) return 'success';
  if (successCount === 0) return 'failed';
  return 'partial';
}

function buildSkippedResult(stepId: string, capabilityId: string, offsetMs: number, issues: PlanIssue[]): StepResult {
  return {
    stepId,
    endpointId: capabilityId,
    status: 'skipped',
    request: { method: 'GET', url: '', headers: {}, query: {}, body: null },
    attempts: [],
    finalStatus: null,
    totalDurationMs: 0,
    startedAtOffsetMs: offsetMs,
    responseBody: null,
    issues,
  };
}

/**
 * Run a `planner/schema.ts` `WorkflowPlan` to completion in mock/test mode and
 * return an `ExecutionTrace`. `validation` must come from a fresh, server-side
 * `validatePlan(plan)` call — the caller (the route) is responsible for
 * rejecting invalid plans before this runs.
 */
export async function runCapabilityWorkflow(
  plan: WorkflowPlan,
  validation: PlanValidation,
  options: CapabilityRunOptions
): Promise<ExecutionTrace> {
  const { capabilitiesById, implementationsByCapability } = loadStore();

  const stepCapability = new Map<string, Capability>();
  const stepImplementation = new Map<string, Implementation>();
  const stepIndex = new Map<string, number>();
  const missingSteps = new Map<string, PlanIssue>();

  plan.steps.forEach((step, index) => {
    stepIndex.set(step.id, index);
    const capability = capabilitiesById.get(step.capability);
    if (!capability) {
      missingSteps.set(step.id, {
        severity: 'error',
        stepId: step.id,
        code: 'unknown_endpoint',
        message: `Unknown capability "${step.capability}".`,
      });
      return;
    }
    stepCapability.set(step.id, capability);

    const implementation = (implementationsByCapability.get(capability.id) ?? [])[0];
    if (!implementation) {
      missingSteps.set(step.id, {
        severity: 'error',
        stepId: step.id,
        code: 'unknown_endpoint',
        message: `No implementation found for capability "${capability.id}".`,
      });
      return;
    }
    stepImplementation.set(step.id, implementation);
  });

  const adapter = new MockAdapter({
    faults: options.faults,
    getResponseSchema: (stepId) => {
      const implementation = stepImplementation.get(stepId);
      if (!implementation?.response_schema) return undefined;
      return { schema: implementation.response_schema as unknown as JsonSchema, example: {} };
    },
    stepIndex,
  });

  const mappingsByStep = new Map<string, ResolvedMapping[]>();
  for (const mapping of validation.resolved_mappings) {
    const list = mappingsByStep.get(mapping.destination_step_id) ?? [];
    list.push(mapping);
    mappingsByStep.set(mapping.destination_step_id, list);
  }

  const stepResponses = new Map<string, JsonValue>();
  const results: StepResult[] = [];
  let offsetMs = 0;

  for (const step of plan.steps) {
    const missing = missingSteps.get(step.id);
    if (missing) {
      results.push(redactStepResult(buildSkippedResult(step.id, step.capability, offsetMs, [missing])));
      continue;
    }

    const capability = stepCapability.get(step.id)!;
    const implementation = stepImplementation.get(step.id)!;
    const inputsByPath = new Map(capability.inputs.map((input) => [input.path, input]));

    const resolvedFields: ResolvedField[] = [];
    const blockingIssues: PlanIssue[] = [];
    const warnings: PlanIssue[] = [];

    for (const mapping of mappingsByStep.get(step.id) ?? []) {
      const inputField = inputsByPath.get(mapping.destination_path);
      if (!inputField) {
        blockingIssues.push({
          severity: 'error',
          stepId: step.id,
          code: 'unresolved_required_field',
          message: `Destination field "${mapping.destination_path}" is not an input of "${capability.id}".`,
        });
        continue;
      }

      let rawValue: JsonValue | undefined;
      if (mapping.source_kind === 'literal') {
        rawValue = mapping.source.startsWith('literal:') ? mapping.source.slice('literal:'.length) : mapping.source;
      } else {
        const sourceResponse = mapping.source_step_id ? stepResponses.get(mapping.source_step_id) : undefined;
        rawValue = sourceResponse !== undefined && mapping.source_path !== undefined
          ? getByPath(sourceResponse, mapping.source_path)
          : undefined;

        if (rawValue === undefined) {
          const issue: PlanIssue = {
            severity: inputField.required ? 'error' : 'warning',
            stepId: step.id,
            code: 'unresolved_required_field',
            message: `Step "${step.id}" needs "${mapping.source}" but step "${mapping.source_step_id}" produced no value at "${mapping.source_path}".`,
          };
          if (inputField.required) blockingIssues.push(issue);
          else warnings.push(issue);
          continue;
        }
      }

      resolvedFields.push({
        path: mapping.destination_path,
        location: inputField.location,
        value: applyTransform(mapping.transform as TransformName | undefined, rawValue),
      });
    }

    if (blockingIssues.length > 0) {
      results.push(redactStepResult(buildSkippedResult(step.id, capability.id, offsetMs, [...blockingIssues, ...warnings])));
      continue;
    }

    let body: JsonValue | null = null;
    const headers: Record<string, string> = { ...implementation.headers };
    const query: Record<string, string> = {};
    const pathParams: Record<string, string> = {};

    for (const field of resolvedFields) {
      switch (field.location) {
        case 'body':
          body = setByPath(body ?? {}, field.path, field.value);
          break;
        case 'header':
          headers[field.path] = toFlatValue(field.value);
          break;
        case 'query':
          query[field.path] = toFlatValue(field.value);
          break;
        case 'path':
          pathParams[field.path] = toFlatValue(field.value);
          break;
        default: {
          const exhaustive: never = field.location;
          throw new Error(`Unknown input location: ${String(exhaustive)}`);
        }
      }
    }

    const auth = buildAuthHeaders(capability.authentication);
    Object.assign(headers, auth.headers);
    Object.assign(query, auth.query);

    const preparedRequest: PreparedRequest = {
      method: implementation.method ?? 'POST',
      url: substituteBraceParams(implementation.endpoint, pathParams),
      headers,
      query,
      body,
    };

    const issues: PlanIssue[] = [...warnings];

    const attempts: Attempt[] = [];
    let attemptNum = 1;

    for (;;) {
      let backoffMs = 0;
      if (attemptNum > 1) {
        const prevAttempt = attempts[attempts.length - 1];
        const retryAfterSeconds = getRetryAfterSeconds(prevAttempt.responseHeaders);
        const backoffRng = seededRng(options.seed, step.id, attemptNum, 'backoff');
        backoffMs = computeBackoffMs(attemptNum - 1, backoffRng, retryAfterSeconds);
      }

      const raw = await adapter.send(preparedRequest, { stepId: step.id, attempt: attemptNum, seed: options.seed });

      const isNetworkError = raw.error !== undefined;
      const attemptError = raw.error ?? (raw.status >= 400 ? { type: 'http' as const, message: `HTTP ${raw.status}` } : undefined);
      const fault = getFaultForStep(options.faults, step.id);
      const faultInjected = isFaultAttempt(fault, attemptNum);

      attempts.push({
        attempt: attemptNum,
        status: raw.status,
        latencyMs: raw.latencyMs,
        backoffMs,
        responseBody: raw.body,
        responseHeaders: raw.headers,
        error: attemptError,
        faultInjected,
      });

      const retry = shouldRetry({ status: isNetworkError ? null : raw.status, isNetworkError, attempt: attemptNum });
      if (!retry) break;
      attemptNum += 1;
    }

    const finalAttempt = attempts[attempts.length - 1];
    const finalStatus = finalAttempt.status;
    const success = finalAttempt.error === undefined && finalStatus >= 200 && finalStatus < 300;
    const status: StepStatus = success ? 'success' : 'failed';
    const totalDurationMs = attempts.reduce((sum, a) => sum + a.latencyMs + a.backoffMs, 0);

    let rateLimit: ReturnType<typeof parseRateLimitHeaders> | undefined;
    for (const attempt of attempts) {
      const info = parseRateLimitHeaders(attempt.responseHeaders, attempt.status);
      if (info.warning !== null) rateLimit = info;
    }
    if (!rateLimit) {
      const finalInfo = parseRateLimitHeaders(finalAttempt.responseHeaders, finalStatus);
      if (finalInfo.limit !== null || finalInfo.remaining !== null || finalInfo.resetSeconds !== null) {
        rateLimit = finalInfo;
      }
    }

    const stepResult: StepResult = {
      stepId: step.id,
      endpointId: capability.id,
      status,
      request: preparedRequest,
      attempts,
      finalStatus,
      totalDurationMs,
      startedAtOffsetMs: offsetMs,
      responseBody: finalAttempt.responseBody,
      rateLimit,
      issues,
    };

    results.push(redactStepResult(stepResult));
    offsetMs += totalDurationMs;
    if (success && finalAttempt.responseBody !== null) {
      stepResponses.set(step.id, finalAttempt.responseBody);
    }
  }

  const traceId = hashString(`${options.seed}|${plan.name}`).toString(16);
  const totalDurationMs = results.reduce((sum, s) => sum + s.totalDurationMs, 0);

  return {
    traceId,
    planId: plan.name,
    mode: 'test',
    seed: options.seed,
    faults: options.faults,
    steps: results,
    status: computeTraceStatus(results),
    totalDurationMs,
    finishedAt: null,
  };
}
