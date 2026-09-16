import type { Capability, CapabilityAuthentication } from '@/knowledge/capability';
import { loadStore } from '@/knowledge/store';
import type { WorkflowPlan } from './schema';
import { isInputCovered, type PlanValidation, type ResolvedMapping } from './validator';

/**
 * Turns a compiled plan + its validation into a shape built for rendering,
 * not for re-deriving anything: every field's status (mapped/unmapped) and
 * *why* is computed once here using the exact same coverage rule the
 * validator itself enforces (`isInputCovered`), so the UI can never show a
 * field as "fine" that the validator would reject, or vice versa.
 */

export type MappingSourceKind = 'literal' | 'field' | 'template' | 'implied';

export interface PresentedMapping {
  kind: MappingSourceKind;
  /** Plain-English source, e.g. "from Step 1 → data.object.receipt_email", "fixed value: me". */
  summary: string;
  /** The raw mapping source string, for a "view raw" affordance. */
  raw: string;
  transform?: string;
  source_step_id?: string;
  source_path?: string;
  /** step ids referenced by a template's {step_N.path} placeholders, in first-seen order. */
  referenced_step_ids?: string[];
}

export interface PresentedField {
  path: string;
  /** Nesting depth relative to the capability's own input list (for indentation). */
  depth: number;
  required: boolean;
  type: string;
  semantic_type: string;
  location: string;
  status: 'mapped' | 'missing';
  mapping?: PresentedMapping;
}

export interface PresentedStep {
  step_id: string;
  capability_id: string;
  provider_id: string;
  kind: 'action' | 'event';
  purpose: string;
  side_effect: string;
  confidence: number;
  authentication: CapabilityAuthentication;
  /** Required fields, plus any optional field that did get a mapping — never the full optional field list. */
  fields: PresentedField[];
  ready: boolean;
  missing_required_count: number;
}

const TEMPLATE_PLACEHOLDER_STEP = /\{(step_\d+)\./g;

function describeMapping(mapping: ResolvedMapping): PresentedMapping {
  if (mapping.source_kind === 'literal') {
    const value = mapping.source.slice('literal:'.length);
    return { kind: 'literal', summary: `fixed value: ${value}`, raw: value, transform: mapping.transform };
  }

  if (mapping.source_kind === 'template') {
    const body = mapping.source.slice('template:'.length);
    const referenced = [...new Set([...mapping.source.matchAll(TEMPLATE_PLACEHOLDER_STEP)].map((m) => m[1]))];
    return {
      kind: 'template',
      summary: referenced.length > 0 ? `composed from ${referenced.join(', ')}` : 'composed (fixed text)',
      raw: body,
      transform: mapping.transform,
      referenced_step_ids: referenced,
    };
  }

  return {
    kind: 'field',
    summary: `from ${mapping.source_step_id} → ${mapping.source_path}`,
    raw: mapping.source,
    transform: mapping.transform,
    source_step_id: mapping.source_step_id,
    source_path: mapping.source_path,
  };
}

function presentStep(
  step: WorkflowPlan['steps'][number],
  capability: Capability | undefined,
  mappingsByDestination: Map<string, ResolvedMapping>
): PresentedStep {
  if (!capability) {
    return {
      step_id: step.id,
      capability_id: step.capability,
      provider_id: 'unknown',
      kind: 'action',
      purpose: step.purpose,
      side_effect: 'unknown',
      confidence: 0,
      authentication: { kind: 'none' },
      fields: [],
      ready: false,
      missing_required_count: 1,
    };
  }

  const mappedPaths = new Set(
    [...mappingsByDestination.keys()]
      .filter((destination) => destination.startsWith(`${step.id}.`))
      .map((destination) => destination.slice(step.id.length + 1))
  );

  const fields: PresentedField[] = capability.inputs
    .filter((input) => input.required || mappedPaths.has(input.path))
    .map((input) => {
      const mapping = mappingsByDestination.get(`${step.id}.${input.path}`);
      let presentedMapping = mapping ? describeMapping(mapping) : undefined;

      // A required field with no mapping of its own can still be covered by a
      // mapped ancestor (the container was set wholesale) or a mapped
      // descendant (one of its own children was set) — same rule the
      // validator uses (isInputCovered). Surface *which* related path covers
      // it rather than just silently marking it "mapped".
      if (!presentedMapping && input.required && isInputCovered(input.path, mappedPaths)) {
        const coveringPath = [...mappedPaths].find(
          (path) => input.path.startsWith(`${path}.`) || path.startsWith(`${input.path}.`)
        )!;
        presentedMapping = { kind: 'implied', summary: `covered via ${coveringPath}`, raw: coveringPath };
      }

      return {
        path: input.path,
        depth: (input.path.match(/\./g) ?? []).length,
        required: input.required,
        type: input.type,
        semantic_type: input.semantic_type,
        location: input.location,
        status: presentedMapping ? 'mapped' : 'missing',
        mapping: presentedMapping,
      };
    });

  const missingRequiredCount = fields.filter((field) => field.required && field.status === 'missing').length;

  return {
    step_id: step.id,
    capability_id: capability.id,
    provider_id: capability.provider_id,
    kind: capability.kind,
    purpose: step.purpose,
    side_effect: capability.side_effects.kind,
    confidence: capability.confidence,
    authentication: capability.authentication,
    fields,
    ready: missingRequiredCount === 0,
    missing_required_count: missingRequiredCount,
  };
}

export function presentPlan(plan: WorkflowPlan, validation: PlanValidation): PresentedStep[] {
  const { capabilitiesById } = loadStore();
  const mappingsByDestination = new Map(validation.resolved_mappings.map((mapping) => [mapping.destination, mapping]));

  return plan.steps.map((step) => presentStep(step, capabilitiesById.get(step.capability), mappingsByDestination));
}
