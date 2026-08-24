import type { JsonValue } from '@/types/endpoint';
import type { FieldMapping, MappingSource, PlanIssue, WorkflowStep } from '@/types/workflow';
import { getByPath } from '@/lib/utils/json-path';
import { isForwardReference, parseRef, type StepRef } from './ref';
import type { ResolvedMapping } from './compose';

export type UnresolvedCode = 'invalid_ref' | 'forward_reference' | 'unresolved_required_field';

export type ResolveOutcome =
  | { status: 'resolved'; value: JsonValue }
  | { status: 'unresolved'; reason: string; code: UnresolvedCode };

export interface ResolveContext {
  triggerPayload: JsonValue;
  /** Response bodies of steps that ran successfully earlier in this execution. */
  stepResponses: ReadonlyMap<string, JsonValue>;
  /** Ids of steps that are earlier than the current one in the linear plan. */
  earlierStepIds: ReadonlySet<string>;
  currentStepId: string;
}

/** Resolve a single mapping's source against the current execution context. */
export function resolveMappingSource(source: MappingSource, ctx: ResolveContext): ResolveOutcome {
  switch (source.kind) {
    case 'literal':
      return { status: 'resolved', value: source.value };

    case 'secret':
      // Never resolved here — only inside live-adapter.send. The placeholder
      // itself is what gets stored in the trace (already masked).
      return { status: 'resolved', value: `<${source.envVar}>` };

    case 'unresolved':
      return { status: 'unresolved', reason: source.reason, code: 'unresolved_required_field' };

    case 'ref': {
      const parsed = parseRef(source.expression);
      if (!parsed.ok) {
        return { status: 'unresolved', reason: parsed.error, code: 'invalid_ref' };
      }

      if (parsed.ref.kind === 'trigger') {
        const value = getByPath(ctx.triggerPayload, parsed.ref.path);
        if (value === undefined) {
          return {
            status: 'unresolved',
            reason: `Trigger payload has no value at "${parsed.ref.path}".`,
            code: 'invalid_ref',
          };
        }
        return { status: 'resolved', value };
      }

      const stepRef: StepRef = parsed.ref;
      if (isForwardReference(stepRef, ctx.currentStepId, ctx.earlierStepIds)) {
        return {
          status: 'unresolved',
          reason: `"${source.expression}" is a forward or self reference to step "${stepRef.stepId}".`,
          code: 'forward_reference',
        };
      }

      const response = ctx.stepResponses.get(stepRef.stepId);
      if (response === undefined) {
        return {
          status: 'unresolved',
          reason: `Step "${stepRef.stepId}" has no successful response available.`,
          code: 'invalid_ref',
        };
      }

      const value = getByPath(response, stepRef.path);
      if (value === undefined) {
        return {
          status: 'unresolved',
          reason: `Step "${stepRef.stepId}" response has no value at "${stepRef.path}".`,
          code: 'invalid_ref',
        };
      }
      return { status: 'resolved', value };
    }

    default: {
      const exhaustive: never = source;
      throw new Error(`Unknown mapping source kind: ${String(exhaustive)}`);
    }
  }
}

export interface StepResolution {
  /** Mappings that resolved to a concrete value; feed directly into compose.ts. */
  resolved: ResolvedMapping[];
  /** Unresolved + required=true. Non-empty means the step must be skipped. */
  blockingIssues: PlanIssue[];
  /** Unresolved + required=false. Field is simply omitted from the composed request. */
  warnings: PlanIssue[];
}

function toIssue(
  step: WorkflowStep,
  mapping: FieldMapping,
  outcome: Extract<ResolveOutcome, { status: 'unresolved' }>
): PlanIssue {
  return {
    severity: mapping.required ? 'error' : 'warning',
    stepId: step.id,
    path: mapping.path,
    code: outcome.code,
    message: outcome.reason,
  };
}

/** Resolve every mapping on a step, splitting resolved vs. blocking vs. warning outcomes. */
export function resolveStepMappings(step: WorkflowStep, ctx: ResolveContext): StepResolution {
  const resolved: ResolvedMapping[] = [];
  const blockingIssues: PlanIssue[] = [];
  const warnings: PlanIssue[] = [];

  for (const mapping of step.mappings) {
    const outcome = resolveMappingSource(mapping.source, ctx);
    if (outcome.status === 'resolved') {
      resolved.push({ mapping, value: outcome.value });
    } else if (mapping.required) {
      blockingIssues.push(toIssue(step, mapping, outcome));
    } else {
      warnings.push(toIssue(step, mapping, outcome));
    }
  }

  return { resolved, blockingIssues, warnings };
}
