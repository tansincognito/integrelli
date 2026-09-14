import { generateObject } from 'ai';
import { modelFor, modelsAvailable } from '@/models';
import type { ProviderSeed } from '../sources';
import { LlmCapabilityDraftSchema, type LlmCapabilityDraft } from '../types';
import type { DocChunk } from './markdown';

/**
 * Path B extraction. The model's only job is to read one documentation chunk
 * and fill in a fixed schema — it never chooses the schema, the provider, the
 * base URL, or the credential. Output is validated by Zod at the tool boundary,
 * so free-form prose cannot enter the knowledge base.
 *
 * Returns null (never throws) when models are unavailable or the call fails,
 * so the pipeline can fall back to the deterministic heuristic extractor.
 */
export async function extractWithLlm(
  chunk: DocChunk,
  seed: ProviderSeed
): Promise<{ draft: LlmCapabilityDraft; model: string } | null> {
  if (!modelsAvailable()) return null;

  const model = modelFor('extraction');

  try {
    const { object } = await generateObject({
      model,
      schema: LlmCapabilityDraftSchema,
      system: buildExtractionPrompt(seed),
      prompt: `Documentation section: "${chunk.heading}"\n\n${chunk.text}`,
    });
    return { draft: object, model };
  } catch (err) {
    console.warn(
      `[integrelli] LLM extraction failed for ${seed.id} "${chunk.heading}": ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

function buildExtractionPrompt(seed: ProviderSeed): string {
  return `You extract one API capability from a section of ${seed.name} developer documentation.

RULES:
- Report only what the section states. Never infer an endpoint, parameter, or scope that is not written down.
- "name" is a snake_case verb_noun for the operation, with NO provider prefix (e.g. "text_to_speech", "create_contact").
- "path" is the URL path only, keeping {placeholder} segments — no scheme, no host, no query string.
- Mark a parameter required only if the documentation says so explicitly.
- "response_fields" are the top-level fields of the success response body.
- Never output an API key, token, or any other credential value. Report authentication as a kind and, if applicable, the header or query parameter NAME only.
- If the section documents an event or webhook the provider sends, set kind to "event"; otherwise "action".`;
}
