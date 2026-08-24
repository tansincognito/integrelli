import { describe, expect, it } from 'vitest';
import { runWorkflow } from '@/lib/exec/engine';
import { shouldRetry, isRetryableStatus, MAX_ATTEMPTS } from '@/lib/exec/retry';
import type { WorkflowPlan, WorkflowStep } from '@/types/workflow';
import type { FaultInjection, RunOptions } from '@/types/execution';

function buildStep(): WorkflowStep {
  return {
    id: 'step_1',
    order: 0,
    endpointId: 'slack.post_message',
    title: 'Post to Slack',
    rationale: 'Notify the team.',
    mappings: [
      { path: 'channel', target: 'body', required: true, source: { kind: 'literal', value: 'C0123ABC' } },
      { path: 'text', target: 'body', required: true, source: { kind: 'literal', value: 'hello' } },
    ],
  };
}

function buildPlan(): WorkflowPlan {
  return {
    version: 1,
    id: 'plan_retry_fixture',
    name: 'Retry fixture',
    description: 'Single-step plan used to exercise fault injection + retry.',
    prompt: 'Post a Slack message.',
    trigger: {
      service: 'manual',
      eventName: 'manual.trigger',
      description: 'Manually triggered.',
      payloadSchema: { type: 'object', properties: {} },
      samplePayload: {},
    },
    steps: [buildStep()],
    issues: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function runOptions(faults: FaultInjection[]): RunOptions {
  return { seed: 'integrelli', mode: 'test', faults };
}

describe('retry policy (pure functions)', () => {
  it('flags 429 and 5xx as retryable', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });

  it('does not flag 400 (or other non-listed 4xx) as retryable', () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });

  it('shouldRetry returns false for a 400 on the first attempt (non-retryable 4xx fails immediately)', () => {
    expect(shouldRetry({ status: 400, isNetworkError: false, attempt: 1 })).toBe(false);
  });

  it('shouldRetry returns true for a 429/500 while under MAX_ATTEMPTS, false once exhausted', () => {
    expect(shouldRetry({ status: 429, isNetworkError: false, attempt: 1 })).toBe(true);
    expect(shouldRetry({ status: 500, isNetworkError: false, attempt: MAX_ATTEMPTS - 1 })).toBe(true);
    expect(shouldRetry({ status: 500, isNetworkError: false, attempt: MAX_ATTEMPTS })).toBe(false);
  });
});

describe('retry policy (engine + mock adapter integration)', () => {
  it('a 429 fault produces multiple attempts, a recorded backoff sequence, and a rate-limit warning', async () => {
    const plan = buildPlan();
    const faults: FaultInjection[] = [{ stepId: 'step_1', status: 429, applyToAttempts: 2 }];
    const trace = await runWorkflow(plan, runOptions(faults));

    const step = trace.steps[0];
    expect(step.attempts.length).toBe(3);
    expect(step.attempts[0].status).toBe(429);
    expect(step.attempts[0].faultInjected).toBe(true);
    expect(step.attempts[0].backoffMs).toBe(0);
    expect(step.attempts[1].status).toBe(429);
    expect(step.attempts[1].faultInjected).toBe(true);
    expect(step.attempts[1].backoffMs).toBeGreaterThan(0);
    expect(step.attempts[2].status).toBe(200);
    expect(step.attempts[2].faultInjected).toBe(false);
    expect(step.attempts[2].backoffMs).toBeGreaterThan(0);
    // Backoff is recorded but never slept in test mode.
    expect(step.status).toBe('success');
    expect(step.rateLimit).toBeDefined();
    expect(step.rateLimit?.warning).toContain('429');
  });

  it('a 500 fault also retries and eventually succeeds', async () => {
    const plan = buildPlan();
    const faults: FaultInjection[] = [{ stepId: 'step_1', status: 500, applyToAttempts: 1 }];
    const trace = await runWorkflow(plan, runOptions(faults));

    const step = trace.steps[0];
    expect(step.attempts.length).toBe(2);
    expect(step.attempts[0].status).toBe(500);
    expect(step.attempts[0].faultInjected).toBe(true);
    expect(step.attempts[1].status).toBe(200);
    expect(step.status).toBe('success');
  });

  it('a fault applied to all attempts exhausts retries and the step is marked failed', async () => {
    const plan = buildPlan();
    const faults: FaultInjection[] = [{ stepId: 'step_1', status: 503, applyToAttempts: 'all' }];
    const trace = await runWorkflow(plan, runOptions(faults));

    const step = trace.steps[0];
    expect(step.attempts.length).toBe(MAX_ATTEMPTS);
    expect(step.attempts.every((a) => a.status === 503 && a.faultInjected)).toBe(true);
    expect(step.status).toBe('failed');
    expect(step.finalStatus).toBe(503);
  });

  it('backoff sequence roughly doubles per retry (250-349ms, then 500-599ms)', async () => {
    const plan = buildPlan();
    const faults: FaultInjection[] = [{ stepId: 'step_1', status: 500, applyToAttempts: 2 }];
    const trace = await runWorkflow(plan, runOptions(faults));

    const [attempt1, attempt2, attempt3] = trace.steps[0].attempts;
    expect(attempt1.backoffMs).toBe(0);
    expect(attempt2.backoffMs).toBeGreaterThanOrEqual(250);
    expect(attempt2.backoffMs).toBeLessThan(350);
    expect(attempt3.backoffMs).toBeGreaterThanOrEqual(500);
    expect(attempt3.backoffMs).toBeLessThan(600);
  });
});
