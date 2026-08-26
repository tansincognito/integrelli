import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validatePlan, type WorkflowPlan } from '@/planner';
import { runCapabilityWorkflow } from '@/lib/exec/capability-engine';
import type { FaultInjection } from '@/types/execution';

export const runtime = 'nodejs';

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)])
);

const FaultInjectionSchema = z.object({
  stepId: z.string(),
  status: z.union([z.literal(429), z.literal(500), z.literal(502), z.literal(503)]),
  applyToAttempts: z.union([z.number().int().positive(), z.literal('all')]),
  body: JsonValueSchema.optional(),
});

const RequestEnvelopeSchema = z.object({
  plan: z.unknown(),
  seed: z.string().min(1),
  mode: z.enum(['test', 'live']).optional(),
  faults: z.array(FaultInjectionSchema).default([]),
});

/**
 * POST /api/workflow/execute — the ingested-capability-graph counterpart to
 * `/api/execute` (which only knows the hand-authored `EndpointSpec` pack).
 *
 * The client can edit a plan in the browser, so `plan` is never trusted as
 * already-valid: it is re-validated with `validatePlan` here regardless of
 * what the caller sent, same principle as `/api/execute` re-validating with
 * Zod on every call.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const parsed = RequestEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body.', issues: parsed.error.flatten() }, { status: 400 });
  }

  const { plan: rawPlan, seed, mode, faults } = parsed.data;

  if (mode === 'live') {
    return NextResponse.json(
      { error: 'Live mode is not yet supported for the capability graph. Use mode "test" (or omit mode).' },
      { status: 400 }
    );
  }

  const validation = validatePlan(rawPlan);
  if (!validation.valid) {
    return NextResponse.json(
      { error: 'Plan failed validation; refusing to execute an invalid plan.', validation },
      { status: 422 }
    );
  }

  try {
    const trace = await runCapabilityWorkflow(rawPlan as WorkflowPlan, validation, {
      seed,
      faults: faults as FaultInjection[],
    });
    return NextResponse.json({ trace }, { status: 200 });
  } catch (err) {
    console.error('[integrelli] /api/workflow/execute failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown execution error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
