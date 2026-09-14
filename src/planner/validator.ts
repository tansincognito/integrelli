import type { Capability } from '@/knowledge/capability';
import { findField, isCompatible, type SchemaField } from '@/knowledge/schema';
import { loadStore } from '@/knowledge/store';
import { EXECUTION_MODES, WorkflowPlanSchema, type PlanMapping, type WorkflowPlan } from './schema';

/**
 * Plan validation (architecture.md section 8).
 *
 * The planner proposes; this decides. Nothing here asks a model anything — a
 * plan is valid or invalid against the capability graph, and that is a
 * deterministic question. A plan that fails any error-level check is rejected
 * whole, because a workflow with one unresolvable mapping is not a workflow.
 */

export type PlanIssueCode =
  | 'schema_invalid'
  | 'unsupported_execution_mode'
  | 'step_ids_not_sequential'
  | 'duplicate_step_id'
  | 'unknown_capability'
  | 'capability_not_in_candidates'
  | 'event_not_first'
  | 'action_used_as_trigger'
  | 'unresolvable_source'
  | 'unresolvable_destination'
  | 'unknown_source_field'
  | 'unknown_destination_field'
  | 'forward_reference'
  | 'self_reference'
  | 'incompatible_types'
  | 'unmapped_required_input'
  | 'transform_recommended'
  | 'low_confidence_capability';

export interface PlanIssue {
  severity: 'error' | 'warning';
  code: PlanIssueCode;
  message: string;
  step_id?: string;
  mapping_index?: number;
}

/** A mapping with both ends resolved to concrete steps and schema fields. */
export interface ResolvedMapping {
  source: string;
  destination: string;
  transform?: string;
  source_kind: 'literal' | 'field';
  source_step_id?: string;
  source_path?: string;
  destination_step_id: string;
  destination_path: string;
}

export interface PlanValidation {
  valid: boolean;
  errors: PlanIssue[];
  warnings: PlanIssue[];
  resolved_mappings: ResolvedMapping[];
}

export interface ValidatePlanOptions {
  /** Capability ids that were actually retrieved; using anything else is suspicious. */
  candidateIds?: string[];
  /** Capabilities below this confidence produce a warning, not a rejection. */
  confidenceWarningThreshold?: number;
}

export function validatePlan(candidate: unknown, options: ValidatePlanOptions = {}): PlanValidation {
  const errors: PlanIssue[] = [];
  const warnings: PlanIssue[] = [];
  const resolved: ResolvedMapping[] = [];

  const parsed = WorkflowPlanSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 8)) {
      errors.push({
        severity: 'error',
        code: 'schema_invalid',
        message: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      });
    }
    return { valid: false, errors, warnings, resolved_mappings: [] };
  }

  const plan: WorkflowPlan = parsed.data;
  const { capabilitiesById } = loadStore();

  if (!EXECUTION_MODES.includes(plan.execution_mode)) {
    errors.push({
      severity: 'error',
      code: 'unsupported_execution_mode',
      message: `Execution mode "${plan.execution_mode}" is not supported. Supported: ${EXECUTION_MODES.join(', ')}.`,
    });
  }

  /* ------------------------------------------------------------- steps -- */

  const stepCapabilities = new Map<string, Capability>();
  const stepOrder = new Map<string, number>();
  const seenStepIds = new Set<string>();

  plan.steps.forEach((step, index) => {
    if (seenStepIds.has(step.id)) {
      errors.push({ severity: 'error', code: 'duplicate_step_id', message: `Step id "${step.id}" appears twice.`, step_id: step.id });
    }
    seenStepIds.add(step.id);
    stepOrder.set(step.id, index);

    if (step.id !== `step_${index + 1}`) {
      errors.push({
        severity: 'error',
        code: 'step_ids_not_sequential',
        message: `Step at position ${index + 1} is "${step.id}"; ids must be step_1..step_n in execution order.`,
        step_id: step.id,
      });
    }

    const capability = capabilitiesById.get(step.capability);
    if (!capability) {
      errors.push({
        severity: 'error',
        code: 'unknown_capability',
        message: `Step "${step.id}" references capability "${step.capability}", which does not exist in the capability graph.`,
        step_id: step.id,
      });
      return;
    }
    stepCapabilities.set(step.id, capability);

    if (options.candidateIds && !options.candidateIds.includes(capability.id)) {
      warnings.push({
        severity: 'warning',
        code: 'capability_not_in_candidates',
        message: `Step "${step.id}" uses "${capability.id}", which was not among the retrieved candidates.`,
        step_id: step.id,
      });
    }

    if (capability.kind === 'event' && index !== 0) {
      errors.push({
        severity: 'error',
        code: 'event_not_first',
        message: `Step "${step.id}" uses event capability "${capability.id}"; events can only start a workflow.`,
        step_id: step.id,
      });
    }

    const threshold = options.confidenceWarningThreshold ?? 0.6;
    if (capability.confidence < threshold) {
      warnings.push({
        severity: 'warning',
        code: 'low_confidence_capability',
        message: `Step "${step.id}" uses "${capability.id}" with confidence ${capability.confidence}; its documentation has not been cross-checked against a machine-readable spec.`,
        step_id: step.id,
      });
    }
  });

  /* ---------------------------------------------------------- mappings -- */

  const mappedDestinations = new Map<string, Set<string>>();

  plan.mappings.forEach((mapping, index) => {
    const destination = resolveReference(mapping.destination, plan, stepCapabilities);
    if (destination.kind !== 'field' || !destination.stepId) {
      errors.push({
        severity: 'error',
        code: 'unresolvable_destination',
        message: `Mapping ${index}: destination "${mapping.destination}" does not resolve to a step field.`,
        mapping_index: index,
      });
      return;
    }

    const destinationCapability = stepCapabilities.get(destination.stepId);
    if (!destinationCapability) return; // already reported as unknown_capability

    const destinationField = findField(destinationCapability.inputs, destination.path);
    if (!destinationField) {
      errors.push({
        severity: 'error',
        code: 'unknown_destination_field',
        message: `Mapping ${index}: "${destination.path}" is not an input of ${destinationCapability.id}.`,
        step_id: destination.stepId,
        mapping_index: index,
      });
      return;
    }

    const destinationSet = mappedDestinations.get(destination.stepId) ?? new Set<string>();
    destinationSet.add(destination.path);
    mappedDestinations.set(destination.stepId, destinationSet);

    const source = resolveReference(mapping.source, plan, stepCapabilities);

    if (source.kind === 'literal') {
      resolved.push({
        source: mapping.source,
        destination: mapping.destination,
        transform: mapping.transform,
        source_kind: 'literal',
        destination_step_id: destination.stepId,
        destination_path: destination.path,
      });
      return;
    }

    if (source.kind !== 'field' || !source.stepId) {
      errors.push({
        severity: 'error',
        code: 'unresolvable_source',
        message: `Mapping ${index}: source "${mapping.source}" does not resolve to a step field or a literal.`,
        mapping_index: index,
      });
      return;
    }

    if (source.stepId === destination.stepId) {
      errors.push({
        severity: 'error',
        code: 'self_reference',
        message: `Mapping ${index}: step "${source.stepId}" cannot map from its own output into its own input.`,
        step_id: source.stepId,
        mapping_index: index,
      });
      return;
    }

    const sourceIndex = stepOrder.get(source.stepId) ?? -1;
    const destinationIndex = stepOrder.get(destination.stepId) ?? -1;
    if (sourceIndex > destinationIndex) {
      errors.push({
        severity: 'error',
        code: 'forward_reference',
        message: `Mapping ${index}: "${mapping.source}" comes from step "${source.stepId}", which runs after "${destination.stepId}".`,
        step_id: destination.stepId,
        mapping_index: index,
      });
      return;
    }

    const sourceCapability = stepCapabilities.get(source.stepId);
    if (!sourceCapability) return;

    const sourceField = findField(sourceCapability.outputs, source.path);
    if (!sourceField) {
      errors.push({
        severity: 'error',
        code: 'unknown_source_field',
        message: `Mapping ${index}: "${source.path}" is not an output of ${sourceCapability.id}.`,
        step_id: source.stepId,
        mapping_index: index,
      });
      return;
    }

    const compatibility = isCompatible(sourceField, destinationField);
    if (!compatibility.compatible) {
      errors.push({
        severity: 'error',
        code: 'incompatible_types',
        message:
          `Mapping ${index}: ${sourceCapability.id}.${source.path} (${describe(sourceField)}) ` +
          `cannot be written to ${destinationCapability.id}.${destination.path} (${describe(destinationField)}) — ${compatibility.reason}.`,
        mapping_index: index,
      });
      return;
    }

    if (
      compatibility.reason === 'coercible' &&
      sourceField.semantic_type !== destinationField.semantic_type &&
      !mapping.transform
    ) {
      warnings.push({
        severity: 'warning',
        code: 'transform_recommended',
        message:
          `Mapping ${index}: ${describe(sourceField)} is being written into ${describe(destinationField)} with no transform declared; ` +
          'the executor will pass the value through unchanged.',
        mapping_index: index,
      });
    }

    resolved.push({
      source: mapping.source,
      destination: mapping.destination,
      transform: mapping.transform,
      source_kind: 'field',
      source_step_id: source.stepId,
      source_path: source.path,
      destination_step_id: destination.stepId,
      destination_path: destination.path,
    });
  });

  /* -------------------------------------------- required input coverage -- */

  for (const step of plan.steps) {
    const capability = stepCapabilities.get(step.id);
    if (!capability || capability.kind === 'event') continue;

    const mapped = mappedDestinations.get(step.id) ?? new Set<string>();
    for (const input of capability.inputs) {
      if (!input.required) continue;
      if (mapped.has(input.path)) continue;
      // A required leaf is satisfied when its parent object is mapped wholesale.
      if ([...mapped].some((path) => input.path.startsWith(`${path}.`))) continue;

      errors.push({
        severity: 'error',
        code: 'unmapped_required_input',
        message: `Step "${step.id}" (${capability.id}) requires input "${input.path}" but no mapping supplies it.`,
        step_id: step.id,
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings, resolved_mappings: resolved };
}

function describe(field: SchemaField): string {
  return `${field.type}/${field.semantic_type}`;
}

interface ResolvedReference {
  kind: 'literal' | 'field' | 'invalid';
  stepId?: string;
  path: string;
}

/**
 * Resolves a mapping reference. Two field forms are accepted because both read
 * naturally and both are unambiguous: `step_2.raw` and
 * `gmail.send_message.raw`. Capability ids contain a dot, so the
 * capability-qualified form is matched by longest prefix against the plan's own
 * steps rather than by splitting on the first dot.
 */
export function resolveReference(
  reference: string,
  plan: WorkflowPlan,
  stepCapabilities: Map<string, Capability>
): ResolvedReference {
  if (reference.startsWith('literal:')) {
    return { kind: 'literal', path: reference.slice('literal:'.length) };
  }

  const stepMatch = /^(step_\d+)\.(.+)$/.exec(reference);
  if (stepMatch) {
    return { kind: 'field', stepId: stepMatch[1], path: stepMatch[2] };
  }

  const byCapability = plan.steps
    .filter((step) => reference.startsWith(`${step.capability}.`))
    .sort((a, b) => b.capability.length - a.capability.length)[0];

  if (byCapability && stepCapabilities.has(byCapability.id)) {
    return { kind: 'field', stepId: byCapability.id, path: reference.slice(byCapability.capability.length + 1) };
  }

  return { kind: 'invalid', path: reference };
}
