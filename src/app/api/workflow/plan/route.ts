import { NextResponse } from 'next/server';
import { z } from 'zod';
import { planWorkflow } from '@/planner';

export const runtime = 'nodejs';

const RequestSchema = z.object({
  request: z.string().min(8).max(2000),
});

/**
 * POST /api/workflow/plan
 *
 * request → intent → retrieved capabilities → proposed plan → validation.
 *
 * Returns the plan *and* its validation result even when the plan is invalid:
 * a rejected plan plus the reasons is more useful to the caller than a bare
 * error. Provider errors and credentials never reach the response body.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body.', issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await planWorkflow(parsed.data.request);

    const payload = {
      intent: result.intent,
      retrieval: {
        method: result.retrieval_method,
        candidates: result.candidates.map((candidate) => ({
          capability_id: candidate.capability_id,
          similarity_score: candidate.similarity_score,
          rank_score: candidate.rank_score,
          provider: candidate.provider,
          api_version: candidate.api_version,
          confidence: candidate.confidence,
          last_verified: candidate.last_verified,
        })),
      },
      plan: result.plan,
      validation: result.validation,
      llm_calls: result.llm_calls,
      error: result.error,
    };

    if (result.error) {
      const status = result.error.code === 'planner_unavailable' ? 503 : 422;
      return NextResponse.json(payload, { status });
    }

    return NextResponse.json(payload, { status: result.validation?.valid ? 200 : 422 });
  } catch (err) {
    console.error('[integrelli] /api/workflow/plan failed:', err);
    return NextResponse.json({ error: 'Internal server error while planning the workflow.' }, { status: 500 });
  }
}
