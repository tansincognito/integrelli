import { generateObject } from 'ai';
import { languageModelFor, modelFor, modelsAvailable } from '@/models';
import type { RetrievedCapability } from '@/retrieval';
import { generateHeuristicPlan } from './heuristic';
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
 *
 * When no model is reachable at all — no credential, or the credential's quota
 * is exhausted — this falls back to `generateHeuristicPlan`, which compiles a
 * plan straight from the capability graph instead of proposing one. That keeps
 * the product usable without any LLM in the loop; see `./heuristic.ts`.
 */
export class PlannerUnavailableError extends Error {}
export class PlanGenerationError extends Error {}

export interface GeneratedPlan {
  plan: WorkflowPlan;
  model: string;
  /** Model calls actually made, including any repair attempt. Zero when heuristic-compiled. */
  llm_calls: number;
  source: 'llm' | 'heuristic';
}

const HEURISTIC_MODEL_LABEL = 'heuristic-graph-compiler';

export async function generateWorkflowPlan(
  intent: Intent,
  candidates: RetrievedCapability[]
): Promise<GeneratedPlan> {
  if (!modelsAvailable()) {
    const heuristic = generateHeuristicPlan(intent, candidates);
    if (heuristic) return { plan: heuristic.plan, model: HEURISTIC_MODEL_LABEL, llm_calls: 0, source: 'heuristic' };
    throw new PlannerUnavailableError(
      'Plan generation requires AI_GATEWAY_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY, and the deterministic graph compiler could not build a plan from the retrieved candidates either.'
    );
  }

  const modelId = modelFor('planner');
  const model = languageModelFor('planner');
  const prompt = buildPlannerPrompt(intent, candidates);

  try {
    const { object } = await generateObject({ model, schema: WorkflowPlanSchema, prompt });
    return { plan: object, model: modelId, llm_calls: 1, source: 'llm' };
  } catch (firstError) {
    const detail = firstError instanceof Error ? firstError.message : String(firstError);
    try {
      const { object } = await generateObject({
        model,
        schema: WorkflowPlanSchema,
        prompt: `${prompt}\n\n---\nA previous attempt failed schema validation with:\n${detail}\nReturn a corrected plan that matches the contract exactly.`,
      });
      return { plan: object, model: modelId, llm_calls: 2, source: 'llm' };
    } catch (secondError) {
      // Model reachable but failing (quota, rate limit, outage) — degrade to
      // the graph compiler rather than surfacing a hard error for something
      // retrieval and validation already have enough data to answer.
      const heuristic = generateHeuristicPlan(intent, candidates);
      if (heuristic) return { plan: heuristic.plan, model: HEURISTIC_MODEL_LABEL, llm_calls: 2, source: 'heuristic' };

      throw new PlanGenerationError(
        `Planner failed to produce a schema-valid plan after one repair attempt: ${
          secondError instanceof Error ? secondError.message : String(secondError)
        }`
      );
    }
  }
}
