import { findFeedLinks } from '@/knowledge/graph';
import type { SideEffectKind } from '@/knowledge/capability';
import type { RetrievedCapability } from '@/retrieval';
import type { Intent, IntentClause } from './intent';
import type { PlanMapping, PlanStep, WorkflowPlan } from './schema';

/**
 * Deterministic fallback planner (architecture.md section 8 extension).
 *
 * The graph already carries everything a plan needs: which capability each
 * clause is about (retrieval + provider hints), which capabilities are
 * events vs. actions, and which output fields can feed which input fields
 * (`can_feed` edges in the knowledge graph). Compiling a plan from that is a
 * lookup problem, not a generation problem — so when no model is available
 * (missing key, exhausted quota), the workflow doesn't have to fail. It
 * degrades to "compiled from the graph" instead of "proposed by a model",
 * same as retrieval degrades from embedding to lexical.
 *
 * This planner never invents a field, a provider, or a step: every step
 * comes from the retrieved candidates and every mapping comes from a
 * `can_feed` edge the graph already computed. What it cannot resolve, it
 * leaves unmapped — the validator reports that honestly as
 * `unmapped_required_input` rather than the heuristic guessing a value.
 */

const MAX_STEPS = 6;

export interface HeuristicPlanResult {
  plan: WorkflowPlan;
}

export function generateHeuristicPlan(intent: Intent, candidates: RetrievedCapability[]): HeuristicPlanResult | null {
  if (candidates.length === 0) return null;

  const selected = selectCapabilities(intent, candidates);
  if (selected.length === 0) return null;

  const bounded = selected.slice(0, MAX_STEPS);
  const stepIdByCapabilityId = new Map<string, string>();
  const steps: PlanStep[] = bounded.map((candidate, index) => {
    const id = `step_${index + 1}`;
    stepIdByCapabilityId.set(candidate.capability_id, id);
    return {
      id,
      capability: candidate.capability_id,
      purpose: candidate.capability.description || `${candidate.capability.side_effects.kind} via ${candidate.provider}`,
    };
  });

  const mappings: PlanMapping[] = [];
  for (let i = 1; i < bounded.length; i++) {
    const destination = bounded[i];
    const requiredInputs = destination.capability.inputs.filter((input) => input.required);
    if (requiredInputs.length === 0) continue;

    // Nearest earlier step first, so a tie between two producers prefers the one closest to this step.
    const producerIds = bounded
      .slice(0, i)
      .map((candidate) => candidate.capability_id)
      .reverse();
    const links = findFeedLinks(producerIds, destination.capability_id);

    for (const input of requiredInputs) {
      const link = links.find((candidate) => candidate.to_path === input.path);
      if (!link) continue;
      const producerStepId = stepIdByCapabilityId.get(link.from_capability_id);
      if (!producerStepId) continue;
      mappings.push({
        source: `${producerStepId}.${link.from_path}`,
        destination: `${steps[i].id}.${input.path}`,
      });
    }
  }

  const providerChain = [...new Set(bounded.map((candidate) => candidate.provider))];

  return {
    plan: {
      execution_mode: 'deterministic',
      name: `Compiled workflow: ${providerChain.join(' → ')}`,
      description: intent.raw,
      steps,
      mappings,
    },
  };
}

/**
 * One capability per clause, in clause order, preferring: this clause's
 * named provider(s), then this clause's expected kind (event for a trigger,
 * action otherwise), highest rank_score breaking ties. Falls back to the
 * single best remaining candidate when a clause names no provider the graph
 * actually retrieved anything for.
 */
function selectCapabilities(intent: Intent, candidates: RetrievedCapability[]): RetrievedCapability[] {
  const used = new Set<string>();
  const selected: RetrievedCapability[] = [];

  for (const clause of intent.clauses) {
    const preferredKind = clause.role === 'trigger' ? 'event' : 'action';
    const hints = clause.provider_hints.length > 0 ? clause.provider_hints : intent.provider_hints;
    const pick = pickCandidate(candidates, used, hints, preferredKind, detectSideEffectKind(clause));
    if (pick) {
      used.add(pick.capability_id);
      selected.push(pick);
    }
  }

  if (selected.length === 0) {
    const pick = pickCandidate(candidates, used, [], 'action', undefined);
    if (pick) selected.push(pick);
  }

  // Only the first step may be an event; if one was retrieved anywhere but
  // first, it belongs at the front rather than dropped.
  const eventIndex = selected.findIndex((candidate) => candidate.capability.kind === 'event');
  if (eventIndex > 0) {
    const [event] = selected.splice(eventIndex, 1);
    selected.unshift(event);
  }

  return selected;
}

function pickCandidate(
  candidates: RetrievedCapability[],
  used: Set<string>,
  hints: string[],
  preferredKind: 'event' | 'action',
  preferredSideEffect: SideEffectKind | undefined
): RetrievedCapability | undefined {
  const pool = candidates.filter((candidate) => !used.has(candidate.capability_id));
  const byHint = hints.length > 0 ? pool.filter((candidate) => hints.includes(candidate.provider)) : pool;
  const byKind = byHint.filter((candidate) => candidate.capability.kind === preferredKind);

  return (
    (preferredSideEffect && best(byKind.filter((candidate) => candidate.capability.side_effects.kind === preferredSideEffect))) ??
    best(byKind) ??
    best(byHint) ??
    best(pool.filter((candidate) => candidate.capability.kind === preferredKind)) ??
    best(pool)
  );
}

function best(pool: RetrievedCapability[]): RetrievedCapability | undefined {
  return pool.slice().sort((a, b) => b.rank_score - a.rank_score)[0];
}

/**
 * Verb hints in a clause map to `SideEffectKind` — "send an email" should
 * outrank "list emails" for a Gmail action step even when the lexical
 * scorer ranks the read-y capability higher on raw term overlap.
 */
const VERB_SIDE_EFFECTS: Array<{ words: string[]; kind: SideEffectKind }> = [
  { words: ['send', 'email', 'message', 'notify', 'post', 'publish', 'sms', 'text'], kind: 'send' },
  { words: ['create', 'add', 'schedule', 'make', 'new'], kind: 'create' },
  { words: ['update', 'edit', 'modify', 'change'], kind: 'update' },
  { words: ['delete', 'remove', 'cancel'], kind: 'delete' },
  { words: ['get', 'list', 'read', 'fetch', 'check', 'look'], kind: 'read' },
];

function detectSideEffectKind(clause: IntentClause): SideEffectKind | undefined {
  if (clause.role === 'trigger') return undefined;
  const lower = clause.text.toLowerCase();
  for (const { words, kind } of VERB_SIDE_EFFECTS) {
    if (words.some((word) => new RegExp(`\\b${word}\\b`).test(lower))) return kind;
  }
  return undefined;
}
