import { NextResponse } from 'next/server';
import { PlanRequestSchema } from '@/schemas/plan-request.zod';
import { retrieveCandidates } from '@/lib/retrieval/retrieve';
import { generatePlan, PlanGenerationError } from '@/lib/llm/generate-plan';
import type { PlanResponse } from '@/types/execution';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const parsed = PlanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body.', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { prompt } = parsed.data;

  try {
    const { candidates, method } = await retrieveCandidates(prompt);

    if (candidates.length === 0) {
      return NextResponse.json(
        { error: 'No candidate endpoints could be retrieved for this prompt.', code: 'no_candidates' },
        { status: 422 }
      );
    }

    const { plan } = await generatePlan(prompt, candidates);

    const response: PlanResponse = {
      plan,
      candidates: candidates.map((c) => ({
        id: c.spec.id,
        score: c.score,
        service: c.spec.service,
        summary: c.spec.description,
      })),
      retrievalMethod: method,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    if (err instanceof PlanGenerationError) {
      return NextResponse.json(
        { error: 'Failed to generate a valid workflow plan for this prompt.', code: 'llm_output_invalid' },
        { status: 422 }
      );
    }
    // Never leak provider errors or the API key to the client.
    console.error('[integrelli] /api/plan failed:', err);
    return NextResponse.json(
      { error: 'Internal server error while generating the plan.' },
      { status: 500 }
    );
  }
}
