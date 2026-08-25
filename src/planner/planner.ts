import { generateObject } from 'ai';
import { modelFor, modelsAvailable } from '@/models';
import type { RetrievedCapability } from '@/retrieval';
import type { Intent } from './intent';
import { buildPlannerPrompt } from './prompt';
import { WorkflowPlanSchema, type WorkflowPlan } from './schema';

/**
 * The planner proposes a workflow and does nothing else (architecture.md
 * section 10, "AI boundaries"): it holds no credentials, calls no provider API,
 * and its output is not trusted until the validator has passed it.
 *
 * One model call per request. The repair attempt only fires when the first call
 * fails outright — a plan that parsed but failed *validation* is returned to the
 * caller with its errors rather than silently re-rolled, because a caller that
 * cannot see the failure cannot fix the request.
 */
export class PlannerUnavailableError extends Error {}
export class PlanGenerationError extends Error {}

export interface GeneratedPlan {
  plan: WorkflowPlan;
  model: string;
  /** Model calls actually made, including any repair attempt. */
  llm_calls: number;
}

export async function generateWorkflowPlan(
  intent: Intent,
  candidates: RetrievedCapability[]
): Promise<GeneratedPlan> {
  if (!modelsAvailable()) {
    throw new PlannerUnavailableError(
      'Plan generation requires AI_GATEWAY_API_KEY. Retrieval and validation work without it; proposing a plan does not.'
    );
  }

  const model = modelFor('planner');
  const prompt = buildPlannerPrompt(intent, candidates);

  try {
    const { object } = await generateObject({ model, schema: WorkflowPlanSchema, prompt });
    return { plan: object, model, llm_calls: 1 };
  } catch (firstError) {
    const detail = firstError instanceof Error ? firstError.message : String(firstError);
    try {
      const { object } = await generateObject({
        model,
        schema: WorkflowPlanSchema,
        prompt: `${prompt}\n\n---\nA previous attempt failed schema validation with:\n${detail}\nReturn a corrected plan that matches the contract exactly.`,
      });
      return { plan: object, model, llm_calls: 2 };
    } catch (secondError) {
      throw new PlanGenerationError(
        `Planner failed to produce a schema-valid plan after one repair attempt: ${
          secondError instanceof Error ? secondError.message : String(secondError)
        }`
      );
    }
  }
}
