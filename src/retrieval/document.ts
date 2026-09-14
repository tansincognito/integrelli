import type { Capability } from '@/knowledge/capability';
import { sha256 } from '@/ingestion/hash';

/**
 * The text that represents one capability to the retrieval layer.
 *
 * Granularity is deliberate: one document per capability, never per
 * documentation page. A page-level embedding forces the planner to receive
 * everything Stripe can do when the user asked for one thing
 * (architecture.md section 7).
 *
 * Inputs and outputs are included because natural-language requests describe
 * data as often as they describe verbs — "send the checkout link by email"
 * names two fields and no operation.
 */
export function buildCapabilityDocument(capability: Capability): string {
  const inputs = capability.inputs
    .filter((input) => input.required || input.path.split('.').length === 1)
    .slice(0, 12)
    .map((input) => `${input.path}${input.description ? ` (${input.description})` : ''}`);

  const outputs = capability.outputs.slice(0, 12).map((output) => output.path);

  return [
    `Capability: ${capability.provider_id} ${humanize(capability.name)}`,
    `Provider: ${capability.provider_id}`,
    `Kind: ${capability.kind}`,
    `Category: ${capability.category}`,
    `Description: ${capability.description}`,
    `Inputs: ${inputs.join(', ') || 'none'}`,
    `Outputs: ${outputs.join(', ') || 'none'}`,
    `Side effects: ${capability.side_effects.kind} — ${capability.side_effects.description}`,
  ].join('\n');
}

/** Content hash of a capability's embedding document — the embedding cache key. */
export function capabilityDocumentHash(capability: Capability): string {
  return sha256(buildCapabilityDocument(capability));
}

function humanize(name: string): string {
  return name.replace(/_/g, ' ');
}
