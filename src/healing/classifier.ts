import type { JsonValue } from '@/types/endpoint';
import type { ExecutionTrace } from '@/types/execution';
import type { Capability } from '@/knowledge/capability';
import type { WorkflowPlan } from '@/planner/schema';
import type { PlanValidation } from '@/planner/validator';
import { getByPath } from '@/lib/utils/json-path';
import { inferSemanticType } from '@/knowledge/schema';
import type { Classification } from './types';

type JsRuntimeType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'undefined';

function jsType(value: unknown): JsRuntimeType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as JsRuntimeType;
}

/** JSON Schema type -> the JS runtime type `typeof`/`Array.isArray` actually produce. */
function declaredJsType(schemaType: string): JsRuntimeType {
  return schemaType === 'integer' ? 'number' : (schemaType as JsRuntimeType);
}

function splitParent(path: string): { parentPath: string; key: string } {
  const idx = path.lastIndexOf('.');
  return idx === -1 ? { parentPath: '', key: path } : { parentPath: path.slice(0, idx), key: path.slice(idx + 1) };
}

/**
 * Deterministic, rule-based failure classification — no model call, so the
 * eval numbers this feeds are reproducible run to run. Two independent
 * signals:
 *
 * 1. Step-level: the call itself came back 401/403 (expired_token) or 404
 *    (removed_endpoint) — nothing about the payload matters here.
 * 2. Mapping-level: for every field-sourced mapping, does the value actually
 *    present in the source step's response still match what the capability
 *    graph says that field is? This is checked independently of whether the
 *    engine's own execution marked the destination step failed — a
 *    type-changed or newly-invalid-enum value doesn't block execution today
 *    (nothing validates outbound values), so relying on `trace.status` alone
 *    would silently miss 2 of the 5 failure classes. This function defines
 *    its own pass/fail notion (contract conformance), the same way
 *    evaluate-trace.ts already does for a different question.
 */
export function classifyFailures(
  plan: WorkflowPlan,
  validation: PlanValidation,
  trace: ExecutionTrace,
  capabilitiesById: ReadonlyMap<string, Capability>
): Classification[] {
  const findings: Classification[] = [];
  const stepById = new Map(trace.steps.map((s) => [s.stepId, s]));
  const capabilityIdByStepId = new Map(plan.steps.map((s) => [s.id, s.capability]));

  const classifiedSteps = new Set<string>();
  for (const step of trace.steps) {
    if (step.finalStatus === 401 || step.finalStatus === 403) {
      findings.push({
        class: 'expired_token',
        stepId: step.stepId,
        confidence: 0.95,
        evidence: `Step "${step.stepId}" received HTTP ${step.finalStatus}.`,
      });
      classifiedSteps.add(step.stepId);
    } else if (step.finalStatus === 404) {
      findings.push({
        class: 'removed_endpoint',
        stepId: step.stepId,
        confidence: 0.95,
        evidence: `Step "${step.stepId}" received HTTP 404 — the endpoint no longer exists at this path.`,
      });
      classifiedSteps.add(step.stepId);
    }
  }

  for (const mapping of validation.resolved_mappings) {
    if (mapping.source_kind !== 'field' || !mapping.source_step_id || !mapping.source_path) continue;
    if (classifiedSteps.has(mapping.destination_step_id)) continue;

    const sourceStep = stepById.get(mapping.source_step_id);
    if (!sourceStep || sourceStep.status !== 'success' || sourceStep.responseBody === null) continue;

    const sourceCapabilityId = capabilityIdByStepId.get(mapping.source_step_id);
    const sourceCapability = sourceCapabilityId ? capabilitiesById.get(sourceCapabilityId) : undefined;
    const declared = sourceCapability?.outputs.find((o) => o.path === mapping.source_path);

    const actual = getByPath(sourceStep.responseBody, mapping.source_path);

    if (actual === undefined) {
      const { parentPath, key } = splitParent(mapping.source_path);
      const parent = parentPath ? getByPath(sourceStep.responseBody, parentPath) : sourceStep.responseBody;
      let candidatePath: string | undefined;

      if (declared && parent && typeof parent === 'object' && !Array.isArray(parent)) {
        const wantType = declaredJsType(declared.type);
        // Two passes: first prefer a sibling whose semantic type (inferred
        // the same way ingestion infers it — name + runtime type) matches
        // the missing field's declared semantic type, since "same JSON
        // type" alone is a weak signal on an object with a dozen strings.
        // Only fall back to bare type-matching if nothing semantic turns up.
        let fallback: string | undefined;
        for (const [siblingKey, siblingValue] of Object.entries(parent as Record<string, JsonValue>)) {
          if (siblingKey === key) continue;
          const siblingType = jsType(siblingValue);
          if (siblingType !== wantType) continue;
          if (fallback === undefined) fallback = parentPath ? `${parentPath}.${siblingKey}` : siblingKey;
          const siblingSemanticType = inferSemanticType(
            siblingKey,
            siblingType === 'array' || siblingType === 'object' ? siblingType : (siblingType as 'string' | 'number' | 'boolean')
          );
          if (siblingSemanticType === declared.semantic_type) {
            candidatePath = parentPath ? `${parentPath}.${siblingKey}` : siblingKey;
            break;
          }
        }
        candidatePath ??= fallback;
      }

      findings.push({
        class: 'renamed_field',
        stepId: mapping.destination_step_id,
        sourceStepId: mapping.source_step_id,
        path: mapping.source_path,
        candidatePath,
        confidence: candidatePath ? 0.75 : 0.3,
        evidence: candidatePath
          ? `"${mapping.source_path}" is gone from step "${mapping.source_step_id}"'s response; found a same-typed sibling at "${candidatePath}".`
          : `"${mapping.source_path}" is gone from step "${mapping.source_step_id}"'s response; no same-typed sibling found nearby.`,
      });
      continue;
    }

    if (!declared) continue;

    const wantType = declaredJsType(declared.type);
    const gotType = jsType(actual);
    if (gotType !== wantType) {
      findings.push({
        class: 'type_change',
        stepId: mapping.destination_step_id,
        sourceStepId: mapping.source_step_id,
        path: mapping.source_path,
        actualValue: actual,
        confidence: 0.85,
        evidence: `"${mapping.source_path}" changed type: capability graph says ${wantType}, response has ${gotType}.`,
      });
      continue;
    }

    if (declared.enum && declared.enum.length > 0 && (gotType === 'string' || gotType === 'number' || gotType === 'boolean')) {
      const known = declared.enum as JsonValue[];
      if (!known.includes(actual as JsonValue)) {
        findings.push({
          class: 'new_enum_value',
          stepId: mapping.destination_step_id,
          sourceStepId: mapping.source_step_id,
          path: mapping.source_path,
          actualValue: actual,
          confidence: 0.8,
          evidence: `"${mapping.source_path}" = ${JSON.stringify(actual)}, outside the declared enum [${known.join(', ')}].`,
        });
      }
    }
  }

  return findings;
}
