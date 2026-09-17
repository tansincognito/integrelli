/**
 * Model abstraction (architecture.md section 10, Decision "Model roles rather
 * than a hardcoded provider").
 *
 * Four roles, four independently-overridable model ids. Roles exist so the
 * expensive model is used only where reasoning is genuinely required: planning
 * is a Sonnet-class job, extraction and reranking are not, and embeddings are a
 * different modality entirely.
 *
 * Language (planner/extraction) and embedding calls resolve their backend
 * *independently*, because one of the three backends can't do embeddings at
 * all. Priority order, each picked by which credential is present:
 *
 *   Language:   AI_GATEWAY_API_KEY > OPENROUTER_API_KEY > GOOGLE_GENERATIVE_AI_API_KEY > none
 *   Embedding:  AI_GATEWAY_API_KEY > GOOGLE_GENERATIVE_AI_API_KEY > none
 *
 *   - `AI_GATEWAY_API_KEY`: plain "provider/model" strings, resolved through
 *     the Vercel AI Gateway (its $5/month free tier or paid credits).
 *   - `OPENROUTER_API_KEY`: OpenRouter's OpenAI-compatible endpoint, via
 *     `@ai-sdk/openai-compatible`. Free-tier model ids there carry a `:free`
 *     suffix (e.g. `nvidia/nemotron-3-ultra-550b-a55b:free`) and are rate- and
 *     availability-limited — fine for ingestion/eval runs, not guaranteed
 *     under load. No embeddings endpoint, so this backend never serves the
 *     `embedding` role. Get a key at https://openrouter.ai/settings/keys.
 *   - `GOOGLE_GENERATIVE_AI_API_KEY`: calls Google's Gemini API directly via
 *     `@ai-sdk/google`, bypassing both of the above — a genuinely free
 *     alternative for language AND the only non-Gateway embedding path, get
 *     one at https://aistudio.google.com/apikey, no card required.
 * None set for a given modality: that modality's calls degrade the same way
 * they always have (see `modelsAvailable`).
 */

import { google } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { EmbeddingModel, LanguageModel } from 'ai';

export type ModelRole = 'planner' | 'extraction' | 'embedding' | 'reranker';
type LanguageBackend = 'gateway' | 'openrouter' | 'google' | 'none';
type EmbeddingBackend = 'gateway' | 'google' | 'none';

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

/**
 * OpenRouter model ids for the language roles only (see file header — no
 * embeddings endpoint there). Both roles default to the same free frontier
 * model; override `INTEGRELLI_MODEL_EXTRACTION` with a smaller `:free` model
 * if this one's rate limit is too tight for extraction's higher call volume.
 */
const OPENROUTER_DEFAULTS: Record<'planner' | 'extraction', string> = {
  planner: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  extraction: 'nvidia/nemotron-3-ultra-550b-a55b:free',
};

const ENV_KEYS: Record<ModelRole, string> = {
  planner: 'INTEGRELLI_MODEL_PLANNER',
  extraction: 'INTEGRELLI_MODEL_EXTRACTION',
  embedding: 'INTEGRELLI_MODEL_EMBEDDING',
  reranker: 'INTEGRELLI_MODEL_RERANKER',
};

function languageBackend(): LanguageBackend {
  if (process.env.AI_GATEWAY_API_KEY?.trim()) return 'gateway';
  if (process.env.OPENROUTER_API_KEY?.trim()) return 'openrouter';
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) return 'google';
  return 'none';
}

function embeddingBackend(): EmbeddingBackend {
  if (process.env.AI_GATEWAY_API_KEY?.trim()) return 'gateway';
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) return 'google';
  return 'none';
}

let openrouterClient: ReturnType<typeof createOpenAICompatible> | undefined;

/** Lazy so a missing OPENROUTER_API_KEY never throws for callers on another backend. */
function openrouter(id: string): LanguageModel {
  openrouterClient ??= createOpenAICompatible({
    name: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
  });
  return openrouterClient.chatModel(id);
}

/** The model id as a string — for logging, cache-versioning, and the embedding index's model tag. Not directly callable. */
export function modelFor(role: ModelRole): string {
  const override = process.env[ENV_KEYS[role]]?.trim();
  if (override) return override;

  if (role === 'embedding') {
    return embeddingBackend() === 'google' ? GOOGLE_DEFAULTS.embedding : GATEWAY_DEFAULTS.embedding;
  }
  if (role === 'reranker') return GATEWAY_DEFAULTS.reranker;

  const backend = languageBackend();
  // Back-compat with the pre-existing single-model env var (gateway backend only).
  if (role === 'planner' && backend === 'gateway' && process.env.INTEGRELLI_MODEL?.trim()) {
    return process.env.INTEGRELLI_MODEL.trim();
  }
  if (backend === 'openrouter') return OPENROUTER_DEFAULTS[role];
  if (backend === 'google') return GOOGLE_DEFAULTS[role];
  return GATEWAY_DEFAULTS[role];
}

/**
 * Whether model calls can be made at all. Every model-touching stage checks
 * this and degrades deterministically rather than throwing: ingestion falls
 * back to the heuristic extractor, retrieval falls back to lexical scoring.
 * Only the planner has no deterministic substitute and reports a real error.
 */
export function modelsAvailable(): boolean {
  return languageBackend() !== 'none';
}

/**
 * The actual callable model for `generateText`/`generateObject`. A gateway
 * string still auto-routes through the Gateway (unchanged behaviour); the
 * Google and OpenRouter backends return a real model instance instead, since
 * a bare id string would otherwise be sent to the Gateway too.
 */
export function languageModelFor(role: 'planner' | 'extraction'): LanguageModel {
  const id = modelFor(role);
  const backend = languageBackend();
  if (backend === 'google') return google(id);
  if (backend === 'openrouter') return openrouter(id);
  return id;
}

/** Same idea as `languageModelFor`, for `embed`/`embedMany`. OpenRouter is never selected here — see file header. */
export function embeddingModelFor(): EmbeddingModel {
  const id = modelFor('embedding');
  return embeddingBackend() === 'google' ? google.textEmbeddingModel(id) : id;
}

/** Version tag stored alongside cached artefacts so a model swap invalidates them. */
export function modelVersionTag(role: ModelRole): string {
  return `${role}:${modelFor(role)}`;
}
