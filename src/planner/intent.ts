import { loadStore } from '@/knowledge/store';

/**
 * Intent extraction — deliberately deterministic (architecture.md section 8,
 * Decision "Intent extraction without a model").
 *
 * Splitting "when X, do Y and then Z" into clauses and spotting provider names
 * is string work. Spending an LLM call on it would double the per-request model
 * cost and add a failure mode, for a job a regex does reliably.
 *
 * The clauses drive *retrieval*, not the plan: each clause becomes its own
 * query so a two-provider request retrieves candidates for both, instead of one
 * blended query that favours whichever provider the phrasing resembles more.
 */
export type ClauseRole = 'trigger' | 'action';

export interface IntentClause {
  text: string;
  role: ClauseRole;
  provider_hints: string[];
}

export interface Intent {
  raw: string;
  clauses: IntentClause[];
  /** Union of provider hints across all clauses. */
  provider_hints: string[];
}

const TRIGGER_PREFIX = /^(when|whenever|after|once|on)\b/i;

/** Splits on clause separators: commas and the conjunctions that chain steps. */
const CLAUSE_SEPARATOR = /,\s*(?:and\s+then|then|and)?\s*|\s+and\s+then\s+|\s+then\s+/i;

export function extractIntent(request: string): Intent {
  const raw = request.trim().replace(/\s+/g, ' ');
  const aliases = providerAliases();

  const segments = splitClauses(raw);
  const clauses: IntentClause[] = segments.map((text, index) => ({
    text,
    role: index === 0 && TRIGGER_PREFIX.test(raw) ? 'trigger' : 'action',
    provider_hints: detectProviders(text, aliases),
  }));

  const wholeRequestHints = detectProviders(raw, aliases);

  return {
    raw,
    clauses: clauses.length > 0 ? clauses : [{ text: raw, role: 'action', provider_hints: wholeRequestHints }],
    provider_hints: wholeRequestHints,
  };
}

function splitClauses(raw: string): string[] {
  return raw
    .replace(/\.$/, '')
    .split(CLAUSE_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 2);
}

/**
 * Provider ids and display names come from the store, so a newly ingested
 * provider is detectable without touching this file. The extra aliases cover
 * the words people use for a provider that are not its name.
 */
const EXTRA_ALIASES: Record<string, string> = {
  'eleven labs': 'elevenlabs',
  'hub spot': 'hubspot',
  'google mail': 'gmail',
};

function providerAliases(): Array<{ alias: string; providerId: string }> {
  const aliases: Array<{ alias: string; providerId: string }> = [];
  for (const provider of loadStore().store.providers) {
    aliases.push({ alias: provider.id.toLowerCase(), providerId: provider.id });
    aliases.push({ alias: provider.name.toLowerCase(), providerId: provider.id });
  }
  for (const [alias, providerId] of Object.entries(EXTRA_ALIASES)) {
    aliases.push({ alias, providerId });
  }
  return aliases;
}

function detectProviders(text: string, aliases: Array<{ alias: string; providerId: string }>): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const { alias, providerId } of aliases) {
    if (new RegExp(`\\b${escapeRegExp(alias)}\\b`).test(lower)) found.add(providerId);
  }
  return [...found];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
