import type { AuthStyle, EndpointSpec, JsonValue } from '@/types/endpoint';
import type { WorkflowPlan, WorkflowStep, PlanIssue } from '@/types/workflow';
import type {
  Attempt,
  ExecutionTrace,
  PreparedRequest,
  RunOptions,
  StepResult,
  StepStatus,
} from '@/types/execution';
import { byId as endpointById } from '@/knowledge/index';
import { hashString, seededRng } from './rng';
import { resolveStepMappings, type ResolveContext } from '@/lib/mapping/resolve';
import { composeRequest, type ComposedRequest } from '@/lib/mapping/compose';
import { validateRequestBody } from '@/lib/mapping/validate';
import { redactStepResult } from './redact';
import { shouldRetry, computeBackoffMs, getRetryAfterSeconds, parseRateLimitHeaders } from './retry';
import { MockAdapter, getFaultForStep, isFaultAttempt } from './mock-adapter';
import { LiveAdapter } from './live-adapter';
import type { HttpAdapter } from './adapter';

/**
 * Thrown by runWorkflow when live mode is requested but the gate fails
 * (missing envVars and/or INTEGRELLI_ALLOW_LIVE not "true"). The route
 * translates this into a 400 with the missing var names.
 */
export class LiveModeGateError extends Error {
  readonly missingEnvVars: string[];
  constructor(message: string, missingEnvVars: string[]) {
    super(message);
    this.name = 'LiveModeGateError';
    this.missingEnvVars = missingEnvVars;
  }
}

function envVarsForAuth(auth: AuthStyle): string[] {
  switch (auth.kind) {
    case 'bearer':
    case 'header':
    case 'query':
      return [auth.envVar];
    case 'basic':
      return [auth.usernameEnvVar, auth.passwordEnvVar];
    default: {
      const exhaustive: never = auth;
      throw new Error(`Unknown auth kind: ${String(exhaustive)}`);
    }
  }
}

function collectReferencedEnvVars(plan: WorkflowPlan): string[] {
  const vars = new Set<string>();
  for (const step of plan.steps) {
    const endpoint = endpointById.get(step.endpointId);
    if (endpoint) {
      for (const v of envVarsForAuth(endpoint.auth)) vars.add(v);
    }
    for (const mapping of step.mappings) {
      if (mapping.source.kind === 'secret') vars.add(mapping.source.envVar);
    }
  }
  return [...vars];
}

function buildAdapter(plan: WorkflowPlan, options: RunOptions, stepsToRun: WorkflowStep[]): HttpAdapter {
  if (options.mode === 'test') {
    const stepEndpointId = new Map<string, string>();
    const stepIndex = new Map<string, number>();
    stepsToRun.forEach((step, index) => {
      stepEndpointId.set(step.id, step.endpointId);
      stepIndex.set(step.id, index);
    });
    return new MockAdapter({
      faults: options.faults,
      getResponseSchema: (stepId) => {
        const endpointId = stepEndpointId.get(stepId);
        const endpoint = endpointId ? endpointById.get(endpointId) : undefined;
        return endpoint ? { schema: endpoint.responseSchema, example: endpoint.exampleResponse } : undefined;
      },
      stepIndex,
    });
  }

  const missingEnvVars = collectReferencedEnvVars(plan).filter((v) => !process.env[v]);
  if (missingEnvVars.length > 0) {
    throw new LiveModeGateError(
      `Live mode requires all referenced environment variables to be set. Missing: ${missingEnvVars.join(', ')}`,
      missingEnvVars
    );
  }
  if (process.env.INTEGRELLI_ALLOW_LIVE !== 'true') {
    throw new LiveModeGateError(
      'Live mode is disabled: INTEGRELLI_ALLOW_LIVE is not "true".',
      []
    );
  }
  return new LiveAdapter();
}

function buildAuthHeaders(auth: AuthStyle): { headers: Record<string, string>; query: Record<string, string> } {
  switch (auth.kind) {
    case 'bearer':
      return { headers: { Authorization: `Bearer <${auth.envVar}>` }, query: {} };
    case 'header':
      return { headers: { [auth.headerName]: `<${auth.envVar}>` }, query: {} };
    case 'basic':
      return {
        headers: { Authorization: `Basic <${auth.usernameEnvVar}>:<${auth.passwordEnvVar}>` },
        query: {},
      };
    case 'query':
      return { headers: {}, query: { [auth.paramName]: `<${auth.envVar}>` } };
    default: {
      const exhaustive: never = auth;
      throw new Error(`Unknown auth kind: ${String(exhaustive)}`);
    }
  }
}

function substitutePathParams(pathTemplate: string, pathParams: Record<string, string>): string {
  return pathTemplate.replace(/:([A-Za-z0-9_]+)/g, (match, name: string) =>
    pathParams[name] !== undefined ? pathParams[name] : match
  );
}

function buildPreparedRequest(endpoint: EndpointSpec, composed: ComposedRequest): PreparedRequest {
  const auth = buildAuthHeaders(endpoint.auth);
  const headers: Record<string, string> = { ...endpoint.headers, ...auth.headers, ...composed.headers };
  const query: Record<string, string> = { ...auth.query, ...composed.query };
  const url = `${endpoint.baseUrl}${substitutePathParams(endpoint.path, composed.path)}`;
  return { method: endpoint.method, url, headers, query, body: composed.body };
}

function emptyPreparedRequest(): PreparedRequest {
  return { method: 'GET', url: '', headers: {}, query: {}, body: null };
}

function computeTraceStatus(steps: StepResult[]): ExecutionTrace['status'] {
  if (steps.length === 0) return 'failed';
  const successCount = steps.filter((s) => s.status === 'success').length;
  if (successCount === steps.length) return 'success';
  if (successCount === 0) return 'failed';
  return 'partial';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSkippedResult(
  step: WorkflowStep,
  request: PreparedRequest,
  offsetMs: number,
  issues: PlanIssue[]
): StepResult {
  return {
    stepId: step.id,
    endpointId: step.endpointId,
    status: 'skipped',
    request,
    attempts: [],
    finalStatus: null,
    totalDurationMs: 0,
    startedAtOffsetMs: offsetMs,
    responseBody: null,
    issues,
  };
}

/**
 * Run a linear WorkflowPlan to completion (or the first hard cap) and return
 * a byte-identical-across-runs ExecutionTrace for the same (plan, seed,
 * mode, faults). No Math.random/Date.now/crypto.randomUUID reachable here in
 * test mode; latency and backoff are synthesized and recorded, never slept.
 */
export async function runWorkflow(plan: WorkflowPlan, options: RunOptions): Promise<ExecutionTrace> {
  const orderedSteps = [...plan.steps].sort((a, b) => a.order - b.order);
  const stepsToRun = options.maxSteps !== undefined ? orderedSteps.slice(0, options.maxSteps) : orderedSteps;

  const adapter = buildAdapter(plan, options, stepsToRun);

  const stepResponses = new Map<string, JsonValue>();
  const earlierStepIds = new Set<string>();
  const results: StepResult[] = [];
  let offsetMs = 0;

  for (const step of stepsToRun) {
    const endpoint = endpointById.get(step.endpointId);

    if (!endpoint) {
      const result = buildSkippedResult(step, emptyPreparedRequest(), offsetMs, [
        {
          severity: 'error',
          stepId: step.id,
          code: 'unknown_endpoint',
          message: `Unknown endpointId "${step.endpointId}".`,
        },
      ]);
      results.push(redactStepResult(result));
      earlierStepIds.add(step.id);
      continue;
    }

    const resolveCtx: ResolveContext = {
      triggerPayload: plan.trigger.samplePayload,
      stepResponses,
      earlierStepIds,
      currentStepId: step.id,
    };
    const resolution = resolveStepMappings(step, resolveCtx);
    const composed = composeRequest(resolution.resolved);
    const preparedRequest = buildPreparedRequest(endpoint, composed);
    const bodyIssues = validateRequestBody(endpoint.requestSchema, preparedRequest.body, { stepId: step.id });
    const issues = [...resolution.blockingIssues, ...resolution.warnings, ...bodyIssues];

    if (resolution.blockingIssues.length > 0) {
      const result = buildSkippedResult(step, preparedRequest, offsetMs, issues);
      results.push(redactStepResult(result));
      earlierStepIds.add(step.id);
      continue;
    }

    const attempts: Attempt[] = [];
    let attemptNum = 1;

    for (;;) {
      let backoffMs = 0;
      if (attemptNum > 1) {
        const prevAttempt = attempts[attempts.length - 1];
        const retryAfterSeconds = getRetryAfterSeconds(prevAttempt.responseHeaders);
        const backoffRng = seededRng(options.seed, step.id, attemptNum, 'backoff');
        backoffMs = computeBackoffMs(attemptNum - 1, backoffRng, retryAfterSeconds);
        if (options.mode === 'live') {
          await sleep(backoffMs);
        }
      }

      const raw = await adapter.send(preparedRequest, {
        stepId: step.id,
        attempt: attemptNum,
        seed: options.seed,
      });

      const isNetworkError = raw.error !== undefined;
      const attemptError = raw.error ?? (raw.status >= 400 ? { type: 'http' as const, message: `HTTP ${raw.status}` } : undefined);
      const fault = getFaultForStep(options.faults, step.id);
      const faultInjected = options.mode === 'test' && isFaultAttempt(fault, attemptNum);

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

      const retry = shouldRetry({
        status: isNetworkError ? null : raw.status,
        isNetworkError,
        attempt: attemptNum,
      });
      if (!retry) break;
      attemptNum += 1;
    }

    const finalAttempt = attempts[attempts.length - 1];
    const finalStatus = finalAttempt.status;
    const success = finalAttempt.error === undefined && finalStatus >= 200 && finalStatus < 300;
    const status: StepStatus = success ? 'success' : 'failed';
    const totalDurationMs = attempts.reduce((sum, a) => sum + a.latencyMs + a.backoffMs, 0);

    // Surface a rate-limit warning from ANY attempt (not just the final one)
    // so a 429-then-succeed sequence still shows up on the StepResult.
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
      endpointId: step.endpointId,
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
    earlierStepIds.add(step.id);
    if (success && finalAttempt.responseBody !== null) {
      stepResponses.set(step.id, finalAttempt.responseBody);
    }
  }

  const traceId = hashString(`${options.seed}|${plan.id}`).toString(16);
  const totalDurationMs = results.reduce((sum, s) => sum + s.totalDurationMs, 0);

  return {
    traceId,
    planId: plan.id,
    mode: options.mode,
    seed: options.seed,
    faults: options.faults,
    steps: results,
    status: computeTraceStatus(results),
    totalDurationMs,
    finishedAt: options.mode === 'live' ? new Date().toISOString() : null,
  };
}
