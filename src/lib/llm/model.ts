/**
 * `anthropic/claude-sonnet-4-5` through the Vercel AI Gateway (DESIGN.md
 * section 5). Plain "provider/model" string, overridable via
 * INTEGRELLI_MODEL for local testing against a different model.
 */
export const DEFAULT_MODEL_ID = 'anthropic/claude-sonnet-4-5';

export const MODEL_ID: string = process.env.INTEGRELLI_MODEL?.trim() || DEFAULT_MODEL_ID;
