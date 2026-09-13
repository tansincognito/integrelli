import { describe, expect, it } from 'vitest';
import { evaluateTrace } from '@/lib/eval/evaluate-trace';
import type { ExecutionTrace, StepResult } from '@/types/execution';

function step(overrides: Partial<StepResult> = {}): StepResult {
  return {
    stepId: 'step_1',
    endpointId: 'stripe.create_customer',
    status: 'success',
    request: { method: 'POST', url: 'https://api.stripe.com/v1/customers', headers: {}, query: {}, body: null },
    attempts: [],
    finalStatus: 200,
    totalDurationMs: 100,
    startedAtOffsetMs: 0,
    responseBody: null,
    issues: [],
    ...overrides,
  };
}

function trace(steps: StepResult[], status: ExecutionTrace['status'] = 'success'): ExecutionTrace {
  return {
    traceId: 't1',
    planId: 'p1',
    mode: 'test',
    seed: 's1',
    faults: [],
    steps,
    status,
    totalDurationMs: steps.reduce((sum, s) => sum + s.totalDurationMs, 0),
    finishedAt: null,
  };
}

describe('evaluateTrace', () => {
  it('passes when every step succeeded with a 2xx status and no blocking issues', () => {
    const result = evaluateTrace(trace([step(), step({ stepId: 'step_2' })]));
    expect(result.passed).toBe(true);
    expect(result.stepEvaluations).toEqual([
      { stepId: 'step_1', passed: true, reasons: [] },
      { stepId: 'step_2', passed: true, reasons: [] },
    ]);
    expect(result.summary).toBe('All 2 step(s) succeeded with no blocking issues.');
  });

  it('fails a step whose status is not "success"', () => {
    const result = evaluateTrace(trace([step({ status: 'failed', finalStatus: 500 })], 'failed'));
    expect(result.passed).toBe(false);
    expect(result.stepEvaluations[0].passed).toBe(false);
    expect(result.stepEvaluations[0].reasons).toContain('status is "failed", expected "success"');
    expect(result.stepEvaluations[0].reasons).toContain('final HTTP status 500 is not 2xx');
  });

  it('fails a step carrying an error-severity issue even if marked success', () => {
    const withIssue = step({
      issues: [{ severity: 'error', stepId: 'step_1', code: 'unresolved_required_field', message: 'missing field' }],
    });
    const result = evaluateTrace(trace([withIssue]));
    expect(result.passed).toBe(false);
    expect(result.stepEvaluations[0].reasons).toContain('unresolved_required_field: missing field');
  });

  it('does not fail a step over a warning-severity issue', () => {
    const withWarning = step({
      issues: [{ severity: 'warning', stepId: 'step_1', code: 'unresolved_required_field', message: 'optional field skipped' }],
    });
    const result = evaluateTrace(trace([withWarning]));
    expect(result.passed).toBe(true);
    expect(result.stepEvaluations[0].reasons).toEqual([]);
  });

  it('fails overall when trace.status is not "success" even if all steps individually look fine', () => {
    const result = evaluateTrace(trace([step()], 'partial'));
    expect(result.passed).toBe(false);
  });

  it('reports "no steps to evaluate" for an empty trace', () => {
    const result = evaluateTrace(trace([]));
    expect(result.summary).toBe('No steps to evaluate.');
  });
});
