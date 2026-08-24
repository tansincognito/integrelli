import { embed } from 'ai';

/**
 * `openai/text-embedding-3-small` (1536 dims) through the Vercel AI Gateway.
 * Plain "provider/model" string — the `ai` package resolves this against the
 * gateway using `AI_GATEWAY_API_KEY` from the environment. No provider
 * package is imported directly (DESIGN.md section 4).
 */
export const EMBEDDING_MODEL_ID = 'openai/text-embedding-3-small';

/**
 * Embeds a single free-text query via the AI Gateway. Throws if no
 * AI_GATEWAY_API_KEY is configured or the call otherwise fails — callers
 * (retrieve.ts) are responsible for catching this and degrading to the
 * lexical scorer rather than crashing the request.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: EMBEDDING_MODEL_ID,
    value: text,
  });
  return embedding;
}
