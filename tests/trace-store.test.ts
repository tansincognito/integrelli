import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getTraceRecord, listTraceSummaries, recordTrace, type TraceRecord } from '@/lib/storage/trace-store';
import type { ExecutionTrace } from '@/types/execution';
import type { WorkflowPlan } from '@/planner/schema';

function makeRecord(traceId: string, recordedAt: string, passed = true): TraceRecord {
  const trace: ExecutionTrace = {
    traceId,
    planId: 'plan_1',
    mode: 'test',
    seed: 's1',
    faults: [],
    steps: [],
    status: passed ? 'success' : 'failed',
    totalDurationMs: 0,
    finishedAt: null,
  };
  const plan: WorkflowPlan = {
    execution_mode: 'deterministic',
    name: 'a plan',
    description: 'desc',
    steps: [],
    mappings: [],
  };
  return {
    trace,
    plan,
    evaluation: { passed, stepEvaluations: [], summary: passed ? 'ok' : 'not ok' },
    recordedAt,
  };
}

describe('trace-store', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'integrelli-trace-store-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a recorded trace by id', async () => {
    const record = makeRecord('abc123', '2026-01-01T00:00:00.000Z');
    await recordTrace(record, dir);

    const found = await getTraceRecord('abc123', dir);
    expect(found).toEqual(record);
  });

  it('returns null for an unknown trace id', async () => {
    expect(await getTraceRecord('does-not-exist', dir)).toBeNull();
  });

  it('lists summaries newest-first', async () => {
    await recordTrace(makeRecord('t1', '2026-01-01T00:00:00.000Z'), dir);
    await recordTrace(makeRecord('t2', '2026-01-03T00:00:00.000Z'), dir);
    await recordTrace(makeRecord('t3', '2026-01-02T00:00:00.000Z'), dir);

    const summaries = await listTraceSummaries(50, dir);
    expect(summaries.map((s) => s.traceId)).toEqual(['t2', 't3', 't1']);
  });

  it('respects the limit', async () => {
    await recordTrace(makeRecord('t1', '2026-01-01T00:00:00.000Z'), dir);
    await recordTrace(makeRecord('t2', '2026-01-02T00:00:00.000Z'), dir);

    expect(await listTraceSummaries(1, dir)).toHaveLength(1);
  });

  it('returns [] when the traces directory does not exist yet', async () => {
    const missingDir = path.join(dir, 'does-not-exist-subdir');
    expect(await listTraceSummaries(50, missingDir)).toEqual([]);
  });

  it('sanitizes the trace id before touching the filesystem', async () => {
    await recordTrace(makeRecord('../../etc/passwd', '2026-01-01T00:00:00.000Z'), dir);
    // Sanitized to "etcpasswd" (path separators and dots stripped) and written inside `dir`, not outside it.
    const found = await getTraceRecord('../../etc/passwd', dir);
    expect(found).not.toBeNull();
  });
});
