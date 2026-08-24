import { describe, expect, it } from 'vitest';
import { runWorkflow } from '@/lib/exec/engine';
import type { WorkflowPlan, WorkflowStep } from '@/types/workflow';
import type { RunOptions, StepResult } from '@/types/execution';

function baseSteps(): WorkflowStep[] {
  return [
    {
      id: 'step_1',
      order: 0,
      endpointId: 'slack.post_message',
      title: 'Post to Slack',
      rationale: 'Notify the team of the deploy.',
      mappings: [
        { path: 'channel', target: 'body', required: true, source: { kind: 'literal', value: 'C0123ABC' } },
        { path: 'text', target: 'body', required: true, source: { kind: 'ref', expression: '$trigger.payload.message' } },
      ],
    },
    {
      id: 'step_2',
      order: 1,
      endpointId: 'slack.post_message',
      title: 'Post follow-up',
      rationale: 'Thread a follow-up under the first message.',
      mappings: [
        { path: 'channel', target: 'body', required: true, source: { kind: 'literal', value: 'C0456DEF' } },
        { path: 'text', target: 'body', required: true, source: { kind: 'literal', value: 'Follow-up.' } },
        { path: 'thread_ts', target: 'body', required: false, source: { kind: 'ref', expression: '$steps.step_1.response.ts' } },
      ],
    },
  ];
}

function buildFixturePlan(opts: { insertExtraStepAtStart?: boolean } = {}): WorkflowPlan {
  const steps = baseSteps();
  if (opts.insertExtraStepAtStart) {
    const extra: WorkflowStep = {
      id: 'step_0',
      order: -1,
      endpointId: 'slack.list_conversations',
      title: 'List channels',
      rationale: 'Look up channels before posting.',
      mappings: [],
    };
    steps.unshift(extra);
    // Reassign order to keep it a simple, valid linear sequence: extra first.
    steps[0].order = 0;
    steps[1].order = 1;
    steps[2].order = 2;
  }

  return {
    version: 1,
    id: 'plan_fixture_1',
    name: 'Deploy notification',
    description: 'Post a deploy notification to Slack, then a threaded follow-up.',
    prompt: 'Notify the team on Slack when a deploy finishes.',
    trigger: {
      service: 'manual',
      eventName: 'manual.trigger',
      description: 'Manually triggered.',
      payloadSchema: { type: 'object', properties: { message: { type: 'string' } } },
      samplePayload: { message: 'Deploy finished successfully.' },
    },
    steps,
    issues: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function runOptions(seed: string): RunOptions {
  return { seed, mode: 'test', faults: [] };
}

function byStepId(steps: StepResult[]): Map<string, StepResult> {
  return new Map(steps.map((s) => [s.stepId, s]));
}

describe('determinism', () => {
  it('produces a byte-identical trace across two runs with the same seed', async () => {
    const plan = buildFixturePlan();
    const traceA = await runWorkflow(plan, runOptions('integrelli'));
    const traceB = await runWorkflow(plan, runOptions('integrelli'));

    expect(JSON.stringify(traceA)).toBe(JSON.stringify(traceB));
  });

  it('never sleeps in test mode: totalDurationMs is purely synthesized', async () => {
    const plan = buildFixturePlan();
    const start = Date.now();
    await runWorkflow(plan, runOptions('integrelli'));
    const wallClockMs = Date.now() - start;
    // Generous ceiling — this is a smoke check that we are not sleeping
    // hundreds/thousands of synthesized backoff+latency ms for real.
    expect(wallClockMs).toBeLessThan(500);
  });

  it('produces a different trace for a different seed', async () => {
    const plan = buildFixturePlan();
    const traceA = await runWorkflow(plan, runOptions('integrelli'));
    const traceC = await runWorkflow(plan, runOptions('a-different-seed'));

    expect(JSON.stringify(traceA)).not.toBe(JSON.stringify(traceC));
    expect(traceA.traceId).not.toBe(traceC.traceId);
  });

  it('inserting a step at position 0 leaves later steps\' mock response values unchanged', async () => {
    const baseline = buildFixturePlan();
    const withInsert = buildFixturePlan({ insertExtraStepAtStart: true });

    const traceBaseline = await runWorkflow(baseline, runOptions('integrelli'));
    const traceInserted = await runWorkflow(withInsert, runOptions('integrelli'));

    const baselineById = byStepId(traceBaseline.steps);
    const insertedById = byStepId(traceInserted.steps);

    // Per-field seeding is keyed by (runSeed, stepId, attempt, schemaPath) —
    // never by array index/order — so step_1 and step_2 keep identical mock
    // response bodies and attempt latencies regardless of what runs before
    // them. Rate-limit headers are deliberately keyed by step index (see
    // mock-adapter.ts) and are excluded from this comparison on purpose.
    for (const stepId of ['step_1', 'step_2']) {
      const before = baselineById.get(stepId);
      const after = insertedById.get(stepId);
      expect(before).toBeDefined();
      expect(after).toBeDefined();
      expect(after?.responseBody).toEqual(before?.responseBody);
      expect(after?.attempts.map((a) => ({ status: a.status, latencyMs: a.latencyMs, backoffMs: a.backoffMs }))).toEqual(
        before?.attempts.map((a) => ({ status: a.status, latencyMs: a.latencyMs, backoffMs: a.backoffMs }))
      );
    }
  });

  it('uses logical offsets, never wall-clock, for startedAtOffsetMs and finishedAt in test mode', async () => {
    const plan = buildFixturePlan();
    const trace = await runWorkflow(plan, runOptions('integrelli'));

    expect(trace.finishedAt).toBeNull();
    expect(trace.steps[0].startedAtOffsetMs).toBe(0);
    expect(trace.steps[1].startedAtOffsetMs).toBe(trace.steps[0].totalDurationMs);
  });
});
