import type { JsonValue } from './endpoint';
import type { WorkflowPlan, PlanIssue } from './workflow';

export type ExecutionMode = 'test' | 'live';

export interface FaultInjection {
  stepId: string;
  status: 429 | 500 | 502 | 503;
  /** Fail this many leading attempts, then succeed. 'all' fails every attempt. */
  applyToAttempts: number | 'all';
  /** Optional override of the mocked error body. */
  body?: JsonValue;
}

export interface RunOptions {
  seed: string;
  mode: ExecutionMode;
  faults: FaultInjection[];
  /** Hard cap; engine stops after this many steps. */
  maxSteps?: number;
}

export interface PreparedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;   // secrets already masked for the trace copy
  query: Record<string, string>;
  body: JsonValue | null;
}

export interface Attempt {
  attempt: number;              // 1-based
  status: number;
  /** Synthesized in test mode from the seeded RNG; measured in live mode. */
  latencyMs: number;
  /** Delay recorded before this attempt (0 for attempt 1). Not slept in test mode. */
  backoffMs: number;
  responseBody: JsonValue | null;
  responseHeaders: Record<string, string>;
  error?: { type: 'http' | 'network' | 'timeout'; message: string };
  faultInjected: boolean;
}

export type StepStatus = 'success' | 'failed' | 'skipped';

export interface StepResult {
  stepId: string;
  endpointId: string;
  status: StepStatus;
  request: PreparedRequest;
  attempts: Attempt[];
  /** Final attempt's status code, or null if never dispatched. */
  finalStatus: number | null;
  /** Sum of attempt latencies + recorded backoffs. */
  totalDurationMs: number;
  /** Logical offset from trace start; keeps traces byte-identical across runs. */
  startedAtOffsetMs: number;
  responseBody: JsonValue | null;
  rateLimit?: {
    limit: number | null;
    remaining: number | null;
    resetSeconds: number | null;
    warning: string | null;
  };
  issues: PlanIssue[];
}

export interface ExecutionTrace {
  traceId: string;              // deterministic: hash(seed + plan.id)
  planId: string;
  mode: ExecutionMode;
  seed: string;
  faults: FaultInjection[];
  steps: StepResult[];
  status: 'success' | 'partial' | 'failed';
  totalDurationMs: number;
  /** Never a wall clock in test mode. Live mode sets an ISO timestamp. */
  finishedAt: string | null;
}

export interface ExecuteResponse {
  trace: ExecutionTrace;
}

export interface PlanResponse {
  plan: WorkflowPlan;
  candidates: Array<{ id: string; score: number; service: string; summary: string }>;
  retrievalMethod: 'embedding' | 'lexical';
}
