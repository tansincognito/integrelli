import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExecutionTrace } from '@/types/execution';
import type { WorkflowPlan } from '@/planner/schema';
import type { TraceEvaluation } from '@/lib/eval/evaluate-trace';

/**
 * Server-side execution-trace persistence — the "Runtime Data" box on the
 * architecture diagram. One JSON file per trace under `.data/traces/`
 * (gitignored), zero new dependencies, same pattern the repo already uses
 * for `src/generated/capability-store.json`. Not a database: fine for one
 * developer's MVP traffic, not for concurrent multi-writer load.
 */

export interface TraceRecord {
  trace: ExecutionTrace;
  plan: WorkflowPlan;
  evaluation: TraceEvaluation;
  recordedAt: string;
}

export interface TraceSummary {
  traceId: string;
  planId: string;
  planName: string;
  mode: ExecutionTrace['mode'];
  status: ExecutionTrace['status'];
  passed: boolean;
  recordedAt: string;
}

const DEFAULT_TRACES_DIR = path.join(process.cwd(), '.data', 'traces');

function traceFilePath(traceId: string, dir: string): string {
  // traceId is always a hex hash (see capability-engine.ts's hashString), but
  // sanitize before it touches the filesystem regardless.
  const safeId = traceId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(dir, `${safeId}.json`);
}

export async function recordTrace(record: TraceRecord, dir: string = DEFAULT_TRACES_DIR): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(traceFilePath(record.trace.traceId, dir), JSON.stringify(record, null, 2), 'utf-8');
}

export async function getTraceRecord(traceId: string, dir: string = DEFAULT_TRACES_DIR): Promise<TraceRecord | null> {
  try {
    const raw = await readFile(traceFilePath(traceId, dir), 'utf-8');
    return JSON.parse(raw) as TraceRecord;
  } catch {
    return null;
  }
}

export async function listTraceSummaries(limit = 50, dir: string = DEFAULT_TRACES_DIR): Promise<TraceSummary[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const records = await Promise.all(
    files
      .filter((f) => f.endsWith('.json'))
      .map(async (f): Promise<TraceRecord | null> => {
        try {
          return JSON.parse(await readFile(path.join(dir, f), 'utf-8')) as TraceRecord;
        } catch {
          return null;
        }
      })
  );

  return records
    .filter((r): r is TraceRecord => r !== null)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    .slice(0, limit)
    .map((r) => ({
      traceId: r.trace.traceId,
      planId: r.trace.planId,
      planName: r.plan.name,
      mode: r.trace.mode,
      status: r.trace.status,
      passed: r.evaluation.passed,
      recordedAt: r.recordedAt,
    }));
}
