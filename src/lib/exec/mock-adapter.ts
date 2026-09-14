import type { JsonSchema, JsonValue } from '@/types/endpoint';
import type { ExecutionMode, FaultInjection, PreparedRequest } from '@/types/execution';
import type { HttpAdapter, RawHttpResponse } from './adapter';
import { generateMockResponseBody } from './mock-values';
import { hashString, mulberry32 } from './rng';

const LATENCY_MIN_MS = 60;
const LATENCY_RANGE_MS = 340;
const BASE_RATE_LIMIT = 100;

/** `applyToAttempts: 2` fails attempts 1 and 2; attempt 3 succeeds. `'all'` fails every attempt. */
export function isFaultAttempt(fault: FaultInjection | undefined, attempt: number): boolean {
  if (!fault) return false;
  if (fault.applyToAttempts === 'all') return true;
  return attempt <= fault.applyToAttempts;
}

export function getFaultForStep(faults: FaultInjection[], stepId: string): FaultInjection | undefined {
  return faults.find((f) => f.stepId === stepId);
}

function computeRateLimitHeaders(seed: string, stepIndex: number, attempt: number): Record<string, string> {
  const rng = mulberry32(hashString(`${seed}|ratelimit|${stepIndex}|${attempt}`));
  const remaining = Math.max(0, BASE_RATE_LIMIT - stepIndex * 12 - attempt * 3);
  const reset = 30 + Math.floor(rng() * 30);
  const requestIdRng = mulberry32(hashString(`${seed}|request-id|${stepIndex}|${attempt}`));
  const requestId = Math.floor(requestIdRng() * 1e10).toString(36);
  return {
    'x-ratelimit-limit': String(BASE_RATE_LIMIT),
    'x-ratelimit-remaining': String(remaining),
    'x-ratelimit-reset': String(reset),
    'x-request-id': `req_${requestId}`,
  };
}

export interface MockAdapterConfig {
  faults: FaultInjection[];
  /**
   * Response schema (+ optional example to merge over) for a given step id.
   * Undefined means "no known endpoint for this step" and produces a 500.
   */
  getResponseSchema: (stepId: string) => { schema: JsonSchema; example: JsonValue } | undefined;
  /** stepId -> 0-based index within this run, used only for synthesized rate-limit headers. */
  stepIndex: Map<string, number>;
}

/** Deterministic mock responses, derived from each endpoint's responseSchema. Never imports fetch. */
export class MockAdapter implements HttpAdapter {
  readonly mode: ExecutionMode = 'test';

  constructor(private readonly config: MockAdapterConfig) {}

  async send(
    _req: PreparedRequest,
    ctx: { stepId: string; attempt: number; seed: string }
  ): Promise<RawHttpResponse> {
    const stepIndex = this.config.stepIndex.get(ctx.stepId) ?? 0;
    const seedBase = `${ctx.seed}|${ctx.stepId}|${ctx.attempt}`;

    const latencyRng = mulberry32(hashString(`${seedBase}|latency`));
    const latencyMs = LATENCY_MIN_MS + Math.floor(latencyRng() * LATENCY_RANGE_MS);

    const rateLimitHeaders = computeRateLimitHeaders(ctx.seed, stepIndex, ctx.attempt);

    // Fault injection is applied before any mock generation: a fault is a
    // first-class response, exactly like a real one would be.
    const fault = getFaultForStep(this.config.faults, ctx.stepId);
    if (isFaultAttempt(fault, ctx.attempt) && fault) {
      const headers: Record<string, string> = { ...rateLimitHeaders };
      if (fault.status === 429) {
        headers['retry-after'] = '1';
        headers['x-ratelimit-remaining'] = '0';
      }
      const body: JsonValue =
        fault.body ?? {
          error: {
            type: 'fault_injection',
            message: `Injected ${fault.status} fault for step "${ctx.stepId}" (attempt ${ctx.attempt}).`,
          },
        };
      return { status: fault.status, headers, body, latencyMs };
    }

    const target = this.config.getResponseSchema(ctx.stepId);
    if (!target) {
      return {
        status: 500,
        headers: rateLimitHeaders,
        body: { error: { message: `Unknown endpoint for step "${ctx.stepId}".` } },
        latencyMs,
      };
    }

    const body = generateMockResponseBody(target.schema, target.example, seedBase);
    return { status: 200, headers: rateLimitHeaders, body, latencyMs };
  }
}
