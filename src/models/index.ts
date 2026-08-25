/**
 * Model abstraction (architecture.md section 10, Decision "Model roles rather
 * than a hardcoded provider").
 *
 * Four roles, four independently-overridable model ids. Roles exist so the
 * expensive model is used only where reasoning is genuinely required: planning
 * is a Sonnet-class job, extraction and reranking are not, and embeddings are a
 * different modality entirely.
 *
 * All ids are plain "provider/model" strings resolved through the Vercel AI
 * Gateway, so switching a role to a cheap or local model is an env var change,
 * not a code change. Nothing here imports a provider SDK.
 */

export type ModelRole = 'planner' | 'extraction' | 'embedding' | 'reranker';

const DEFAULTS: Record<ModelRole, string> = {
  planner: 'anthropic/claude-sonnet-4-5',
  /** Structured extraction from prose — narrow, schema-constrained, cheap model is enough. */
  extraction: 'anthropic/claude-haiku-4-5',
  embedding: 'openai/text-embedding-3-small',
  /** Reranking is deterministic today; the slot exists so adding a cross-encoder is a config change. */
  reranker: 'none',
};

const ENV_KEYS: Record<ModelRole, string> = {
  planner: 'INTEGRELLI_MODEL_PLANNER',
  extraction: 'INTEGRELLI_MODEL_EXTRACTION',
  embedding: 'INTEGRELLI_MODEL_EMBEDDING',
  reranker: 'INTEGRELLI_MODEL_RERANKER',
};

export function modelFor(role: ModelRole): string {
  const override = process.env[ENV_KEYS[role]]?.trim();
  if (override) return override;
  // Back-compat with the pre-existing single-model env var.
  if (role === 'planner' && process.env.INTEGRELLI_MODEL?.trim()) return process.env.INTEGRELLI_MODEL.trim();
  return DEFAULTS[role];
}

/**
 * Whether model calls can be made at all. Every model-touching stage checks
 * this and degrades deterministically rather than throwing: ingestion falls
 * back to the heuristic extractor, retrieval falls back to lexical scoring.
 * Only the planner has no deterministic substitute and reports a real error.
 */
export function modelsAvailable(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY?.trim());
}

/** Version tag stored alongside cached artefacts so a model swap invalidates them. */
export function modelVersionTag(role: ModelRole): string {
  return `${role}:${modelFor(role)}`;
}
