import { retrieveCapabilities, type RetrievalMethod, type RetrievedCapability } from '@/retrieval';
import { extractIntent, type Intent } from './intent';
import { generateWorkflowPlan, PlannerUnavailableError, PlanGenerationError } from './planner';
import type { WorkflowPlan } from './schema';
import { validatePlan, type PlanValidation } from './validator';

export { extractIntent } from './intent';
export { validatePlan } from './validator';
export { PlannerUnavailableError, PlanGenerationError } from './planner';
export type { WorkflowPlan } from './schema';
export type { PlanValidation, PlanIssue } from './validator';

/**
 * End-to-end planning (architecture.md sections 7 and 8):
 *
 *   request → intent → per-clause retrieval → candidate set → planner → validator
 *
 * Retrieval runs once per clause rather than once for the whole sentence. "When
 * a Stripe payment succeeds, send an email through Gmail" is two different
 * searches; a single blended query returns the payment capabilities twice over
 * and the email capabilities not at all.
 */
export interface PlanRequestResult {
  intent: Intent;
  candidates: RetrievedCapability[];
  retrieval_method: RetrievalMethod;
  plan: WorkflowPlan | null;
  validation: PlanValidation | null;
  llm_calls: number;
  /** Set when the plan could not be produced at all, as opposed to produced and rejected. */
  error?: { code: 'planner_unavailable' | 'plan_generation_failed' | 'no_candidates'; message: string };
}

const MAX_CANDIDATES = 14;
const TRIGGER_CLAUSE_TOP_N = 4;
const ACTION_CLAUSE_TOP_N = 6;

export async function retrieveForRequest(request: string): Promise<{
  intent: Intent;
  candidates: RetrievedCapability[];
  method: RetrievalMethod;
}> {
  const intent = extractIntent(request);
  const merged = new Map<string, RetrievedCapability>();
  let method: RetrievalMethod = 'lexical';

  for (const clause of intent.clauses) {
    const hints = clause.provider_hints.length > 0 ? clause.provider_hints : intent.provider_hints;
    const result = await retrieveCapabilities(clause.text, {
      topN: clause.role === 'trigger' ? TRIGGER_CLAUSE_TOP_N : ACTION_CLAUSE_TOP_N,
      providerHints: hints,
    });
    method = result.method;
    absorb(merged, result.candidates);
  }

  // One pass over the whole request as well, so a capability that only makes
  // sense from the sentence as a whole is not lost to clause splitting.
  const whole = await retrieveCapabilities(intent.raw, {
    topN: ACTION_CLAUSE_TOP_N,
    providerHints: intent.provider_hints,
  });
  method = whole.method;
  absorb(merged, whole.candidates);

  const candidates = [...merged.values()]
    .sort((a, b) => b.rank_score - a.rank_score)
    .slice(0, MAX_CANDIDATES);

  return { intent, candidates, method };
}

export async function planWorkflow(request: string): Promise<PlanRequestResult> {
  const { intent, candidates, method } = await retrieveForRequest(request);

  if (candidates.length === 0) {
    return {
      intent,
      candidates,
      retrieval_method: method,
      plan: null,
      validation: null,
      llm_calls: 0,
      error: { code: 'no_candidates', message: 'No capability in the graph matched this request.' },
    };
  }

  try {
    const generated = await generateWorkflowPlan(intent, candidates);
    const validation = validatePlan(generated.plan, {
      candidateIds: candidates.map((candidate) => candidate.capability_id),
    });

    return {
      intent,
      candidates,
      retrieval_method: method,
      plan: generated.plan,
      validation,
      llm_calls: generated.llm_calls,
    };
  } catch (err) {
    const code = err instanceof PlannerUnavailableError ? 'planner_unavailable' : 'plan_generation_failed';
    if (!(err instanceof PlannerUnavailableError) && !(err instanceof PlanGenerationError)) throw err;

    return {
      intent,
      candidates,
      retrieval_method: method,
      plan: null,
      validation: null,
      llm_calls: 0,
      error: { code, message: err.message },
    };
  }
}

function absorb(target: Map<string, RetrievedCapability>, candidates: RetrievedCapability[]): void {
  for (const candidate of candidates) {
    const existing = target.get(candidate.capability_id);
    if (!existing || candidate.rank_score > existing.rank_score) {
      target.set(candidate.capability_id, candidate);
    }
  }
}
