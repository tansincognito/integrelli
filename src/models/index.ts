/**
 * Model abstraction (architecture.md section 10, Decision "Model roles rather
 * than a hardcoded provider").
 *
 * Four roles, four independently-overridable model ids. Roles exist so the
 * expensive model is used only where reasoning is genuinely required: planning
 * is a Sonnet-class job, extraction and reranking are not, and embeddings are a
 * different modality entirely.
 *
 * Two backends, picked automatically by which credential is present, gateway
 * preferred when both are:
 *   - `AI_GATEWAY_API_KEY` set: plain "provider/model" strings, resolved
 *     through the Vercel AI Gateway (its $5/month free tier or paid credits).
 *   - `GOOGLE_GENERATIVE_AI_API_KEY` set instead: calls Google's Gemini API
 *     directly via `@ai-sdk/google`, bypassing the Gateway (and its cost)
 *     entirely — a genuinely free alternative when Gateway credits run out,
 *     get one at https://aistudio.google.com/apikey, no card required.
 * Neither set: `modelsAvailable()` is false and every stage degrades the same
 * way it always has (see below).
 */

import { google } from '@ai-sdk/google';
import type { EmbeddingModel, LanguageModel } from 'ai';

export type ModelRole = 'planner' | 'extraction' | 'embedding' | 'reranker';
type Backend = 'gateway' | 'google' | 'none';

const GATEWAY_DEFAULTS: Record<ModelRole, string> = {
  planner: 'anthropic/claude-sonnet-4-5',
  /** Structured extraction from prose — narrow, schema-constrained, cheap model is enough. */
  extraction: 'anthropic/claude-haiku-4-5',
  embedding: 'openai/text-embedding-3-small',
  /** Reranking is deterministic today; the slot exists so adding a cross-encoder is a config change. */
  reranker: 'none',
};

/** Google's own model ids (not gateway "provider/model" slugs) for the direct-Gemini backend. */
const GOOGLE_DEFAULTS: Record<ModelRole, string> = {
  planner: 'gemini-2.0-flash',
  extraction: 'gemini-2.0-flash-lite',
  embedding: 'text-embedding-004',
  reranker: 'none',
};

const ENV_KEYS: Record<ModelRole, string> = {
  planner: 'INTEGRELLI_MODEL_PLANNER',
  extraction: 'INTEGRELLI_MODEL_EXTRACTION',
  embedding: 'INTEGRELLI_MODEL_EMBEDDING',
  reranker: 'INTEGRELLI_MODEL_RERANKER',
};

function backend(): Backend {
  if (process.env.AI_GATEWAY_API_KEY?.trim()) return 'gateway';
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) return 'google';
  return 'none';
}

/** The model id as a string — for logging, cache-versioning, and the embedding index's model tag. Not directly callable. */
export function modelFor(role: ModelRole): string {
  const override = process.env[ENV_KEYS[role]]?.trim();
  if (override) return override;
  // Back-compat with the pre-existing single-model env var (gateway backend only).
  if (role === 'planner' && backend() === 'gateway' && process.env.INTEGRELLI_MODEL?.trim()) {
    return process.env.INTEGRELLI_MODEL.trim();
  }
  return backend() === 'google' ? GOOGLE_DEFAULTS[role] : GATEWAY_DEFAULTS[role];
}

/**
 * Whether model calls can be made at all. Every model-touching stage checks
 * this and degrades deterministically rather than throwing: ingestion falls
 * back to the heuristic extractor, retrieval falls back to lexical scoring.
 * Only the planner has no deterministic substitute and reports a real error.
 */
export function modelsAvailable(): boolean {
  return backend() !== 'none';
}

/**
 * The actual callable model for `generateText`/`generateObject`. A gateway
 * string still auto-routes through the Gateway (unchanged behaviour); on the
 * Google backend this returns a real `@ai-sdk/google` model instance instead,
 * since a bare id string would otherwise be sent to the Gateway too.
 */
export function languageModelFor(role: 'planner' | 'extraction'): LanguageModel {
  const id = modelFor(role);
  return backend() === 'google' ? google(id) : id;
}

/** Same idea as `languageModelFor`, for `embed`/`embedMany`. */
export function embeddingModelFor(): EmbeddingModel {
  const id = modelFor('embedding');
  return backend() === 'google' ? google.textEmbeddingModel(id) : id;
}

/** Version tag stored alongside cached artefacts so a model swap invalidates them. */
export function modelVersionTag(role: ModelRole): string {
  return `${role}:${modelFor(role)}`;
}
