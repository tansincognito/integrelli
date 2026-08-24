export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { ExecuteRequestSchema } from '@/schemas/execution.zod';
import { runWorkflow, LiveModeGateError } from '@/lib/exec/engine';
import type { ExecuteResponse, FaultInjection } from '@/types/execution';
import type { WorkflowPlan } from '@/types/workflow';

/**
 * POST /api/execute — re-validates the incoming plan with the full Zod
 * schema on every call. The client can edit mappings in the browser, so the
 * server never trusts the body (DESIGN.md section 7).
 */
export async function POST(request: Request): Promise<NextResponse> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const parsed = ExecuteRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body.', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { seed, mode } = parsed.data;
  // Zod's JsonValue schema is `z.ZodType<unknown>` (see schemas/workflow.zod.ts),
  // so the inferred types carry `unknown` where src/types/* has JsonValue.
  // The shape was already structurally validated above.
  const plan = parsed.data.plan as unknown as WorkflowPlan;
  const faults = parsed.data.faults as unknown as FaultInjection[];

  try {
    const trace = await runWorkflow(plan, { seed, mode, faults });
    const body: ExecuteResponse = { trace };
    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    if (err instanceof LiveModeGateError) {
      return NextResponse.json(
        { error: err.message, missingEnvVars: err.missingEnvVars },
        { status: 400 }
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown execution error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
