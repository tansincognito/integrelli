import type { Capability } from '@/knowledge/capability';
import { findFeedLinks } from '@/knowledge/graph';
import type { RetrievedCapability } from '@/retrieval';
import type { Intent } from './intent';
import { TRANSFORMS } from './schema';

/**
 * The planner prompt (architecture.md section 8).
 *
 * Contains only the retrieved candidates — never the whole graph — plus the
 * wirings the graph already knows are type-compatible. Handing the model the
 * legal moves is cheaper and more accurate than letting it guess and having the
 * validator reject the result.
 */
export function buildPlannerPrompt(intent: Intent, candidates: RetrievedCapability[]): string {
  const catalog = candidates.map((candidate) => renderCapability(candidate.capability, candidate)).join('\n\n');
  const wirings = renderWirings(candidates.map((candidate) => candidate.capability_id));

  return `You are an integration planner. Given a plain-English automation request, you propose a linear workflow built ONLY from the candidate capabilities below.

You propose. A deterministic validator decides whether your proposal is structurally valid, so a plan that invents anything will be rejected outright.

HARD RULES:
- Use ONLY "capability" values that appear verbatim in the candidate list. Never invent one.
- Steps are linear: no branching, no loops, no parallelism. Between 1 and 6 steps.
- Step ids are "step_1", "step_2", ... in execution order, with no gaps.
- An "event" capability may only ever be step_1. Every later step must be an "action".
- Every input marked REQUIRED on a step's capability must be supplied by exactly one mapping.
- A mapping source may reference an EARLIER step only. Never a later step, never the step's own output.
- "execution_mode" must be "deterministic".

MAPPING REFERENCE GRAMMAR:
  step_1.data.object.receipt_email     a field produced by an earlier step
  literal:me                           a constant value you supply
Destinations are always an input of a step: step_2.raw, step_3.channel.

TRANSFORMS (optional per mapping, use the exact name): ${TRANSFORMS.join(', ')}
Use "rfc822_base64url" whenever you map into a Gmail "raw" field, because that field expects an encoded RFC 2822 message rather than a bare value.

USER REQUEST:
${intent.raw}

REQUEST CLAUSES (parsed deterministically, in order):
${intent.clauses.map((clause, i) => `${i + 1}. [${clause.role}] ${clause.text}`).join('\n')}

CANDIDATE CAPABILITIES:
${catalog || '(none retrieved)'}

TYPE-COMPATIBLE WIRINGS ALREADY KNOWN TO THE CAPABILITY GRAPH:
${wirings || '(none)'}

Return the workflow plan object. Include no fields beyond the ones the schema defines.`;
}

function renderCapability(capability: Capability, retrieved: RetrievedCapability): string {
  const inputs = capability.inputs
    .slice(0, 14)
    .map(
      (input) =>
        `  - ${input.path} (${input.location}, ${input.type}/${input.semantic_type})${input.required ? ' REQUIRED' : ''}` +
        `${input.description ? ` — ${input.description}` : ''}`
    );

  const outputs = capability.outputs
    .slice(0, 14)
    .map((output) => `  - ${output.path} (${output.type}/${output.semantic_type})`);

  return [
    `capability: ${capability.id}`,
    `provider: ${capability.provider_id} | api version: ${capability.api_version_id} | kind: ${capability.kind}`,
    `description: ${capability.description}`,
    `side effect: ${capability.side_effects.kind}`,
    `record confidence: ${capability.confidence} | retrieval similarity: ${retrieved.similarity_score}`,
    inputs.length ? `inputs:\n${inputs.join('\n')}` : 'inputs: none',
    outputs.length ? `outputs:\n${outputs.join('\n')}` : 'outputs: none',
  ].join('\n');
}

const MAX_WIRINGS = 24;

function renderWirings(capabilityIds: string[]): string {
  const lines: string[] = [];

  for (const consumerId of capabilityIds) {
    for (const link of findFeedLinks(capabilityIds, consumerId)) {
      lines.push(
        `${link.from_capability_id}.${link.from_path} → ${link.to_capability_id}.${link.to_path} (${link.semantic_type})`
      );
      if (lines.length >= MAX_WIRINGS) return lines.join('\n');
    }
  }

  return lines.join('\n');
}
