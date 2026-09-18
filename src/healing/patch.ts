import type { Capability } from '@/knowledge/capability';
import type { PlanValidation } from '@/planner/validator';
import type { Classification, Patch, PatchAction } from './types';

/**
 * One classification -> one proposed patch. `removed_endpoint` always
 * escalates by design (§ Evaluation: "wrong-patch rate near zero" — there is
 * no local signal that justifies guessing a replacement endpoint) and
 * `renamed_field` escalates whenever the classifier couldn't find a
 * confident replacement, rather than remapping to a guess.
 */
export function proposePatch(classification: Classification): Patch {
  return { classification, action: buildAction(classification) };
}

function buildAction(c: Classification): PatchAction {
  switch (c.class) {
    case 'renamed_field':
      return c.candidatePath && c.path
        ? { kind: 'remap_field', stepId: c.stepId, fromPath: c.path, toPath: c.candidatePath }
        : { kind: 'escalate', stepId: c.stepId, reason: `No confident replacement field found for "${c.path}".` };

    case 'new_enum_value': {
      const valueType = typeof c.actualValue;
      return c.path && c.sourceStepId && (valueType === 'string' || valueType === 'number' || valueType === 'boolean')
        ? { kind: 'accept_enum_value', stepId: c.stepId, sourceStepId: c.sourceStepId, path: c.path, value: c.actualValue as string | number | boolean }
        : { kind: 'escalate', stepId: c.stepId, reason: 'Missing field/value to widen the enum with.' };
    }

    case 'type_change': {
      const toType = typeof c.actualValue;
      return c.path && c.sourceStepId && (toType === 'string' || toType === 'number' || toType === 'boolean')
        ? { kind: 'coerce_type', stepId: c.stepId, sourceStepId: c.sourceStepId, path: c.path, toType }
        : { kind: 'escalate', stepId: c.stepId, reason: 'Observed type is not a coercible primitive.' };
    }

    case 'expired_token':
      return { kind: 'refresh_token', stepId: c.stepId };

    case 'removed_endpoint':
      return { kind: 'escalate', stepId: c.stepId, reason: 'Endpoint is gone; no local signal for what replaced it.' };
  }
}

/** `remap_field`: point this plan's mapping at the field's new name. Returns a new PlanValidation. */
export function applyRemapField(
  validation: PlanValidation,
  action: Extract<PatchAction, { kind: 'remap_field' }>
): PlanValidation {
  return {
    ...validation,
    resolved_mappings: validation.resolved_mappings.map((mapping) =>
      mapping.destination_step_id === action.stepId && mapping.source_path === action.fromPath
        ? { ...mapping, source: mapping.source.replace(action.fromPath, action.toPath), source_path: action.toPath }
        : mapping
    ),
  };
}

/**
 * `accept_enum_value` / `coerce_type`: neither blocks execution today (the
 * engine never validates outbound values against the destination's schema),
 * so "applying" them means updating what the capability graph believes
 * about that field — the knowledge-graph-level fix a real drift-repair
 * agent would actually make. Returns a patched copy of `capabilitiesById`;
 * the original is left untouched.
 */
export function applyKnowledgePatch(
  capabilitiesById: ReadonlyMap<string, Capability>,
  action: Extract<PatchAction, { kind: 'accept_enum_value' } | { kind: 'coerce_type' }>,
  sourceCapabilityId: string
): ReadonlyMap<string, Capability> {
  const capability = capabilitiesById.get(sourceCapabilityId);
  if (!capability) return capabilitiesById;

  const patched: Capability = {
    ...capability,
    outputs: capability.outputs.map((output) => {
      if (output.path !== action.path) return output;
      if (action.kind === 'accept_enum_value') {
        return { ...output, enum: output.enum ? [...output.enum, action.value] : output.enum };
      }
      return { ...output, type: action.toType === 'boolean' ? 'boolean' : action.toType };
    }),
  };

  const next = new Map(capabilitiesById);
  next.set(sourceCapabilityId, patched);
  return next;
}
