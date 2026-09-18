import type { Capability } from '@/knowledge/capability';
import { loadStore } from '@/knowledge/store';
import { runCapabilityWorkflow, type CapabilityRunOptions } from '@/lib/exec/capability-engine';
import type { WorkflowPlan } from '@/planner/schema';
import type { PlanValidation } from '@/planner/validator';
import type { ExecutionTrace } from '@/types/execution';
import { classifyFailures } from './classifier';
import { applyKnowledgePatch, applyRemapField, proposePatch } from './patch';
import type { Classification, DriftScenario, RepairAttempt } from './types';

export interface RepairRunResult {
  scenario: DriftScenario;
  initialTrace: ExecutionTrace;
  finalTrace: ExecutionTrace;
  attempts: RepairAttempt[];
}

/**
 * The self-healing loop for one drift scenario: run once with the drift
 * active, classify whatever `classifyFailures` finds, propose+apply a patch
 * per finding, re-run (or re-classify against patched knowledge, for the
 * two classes that don't need re-execution — see patch.ts), and record
 * auto_repaired / escalated / wrong_patch per finding.
 *
 * A plan can surface more than one finding (e.g. two mappings drift off the
 * same trace) — each gets its own patch attempt, independently scored,
 * which is what the eval harness's per-class metrics are counted over.
 */
export async function runSelfHealing(
  plan: WorkflowPlan,
  validation: PlanValidation,
  options: CapabilityRunOptions,
  scenario: DriftScenario
): Promise<RepairRunResult> {
  const { capabilitiesById } = loadStore();
  const capabilityIdByStepId = new Map(plan.steps.map((s) => [s.id, s.capability]));

  const initialTrace = await runCapabilityWorkflow(plan, validation, options);
  const findings = classifyFailures(plan, validation, initialTrace, capabilitiesById);

  const attempts: RepairAttempt[] = [];
  let finalTrace = initialTrace;

  for (const finding of findings) {
    const patch = proposePatch(finding);

    if (patch.action.kind === 'escalate') {
      attempts.push({ classification: finding, patch, outcome: 'escalated' });
      continue;
    }

    if (patch.action.kind === 'remap_field') {
      const patchedValidation = applyRemapField(validation, patch.action);
      const rerun = await runCapabilityWorkflow(plan, patchedValidation, options);
      const remaining = classifyFailures(plan, patchedValidation, rerun, capabilitiesById).filter(
        (f) => f.stepId === finding.stepId && f.path === finding.path
      );
      finalTrace = rerun;
      attempts.push({ classification: finding, patch, outcome: remaining.length === 0 ? 'auto_repaired' : 'wrong_patch' });
      continue;
    }

    if (patch.action.kind === 'refresh_token') {
      const remainingScenarios = (options.driftScenarios ?? []).filter((s) => s.stepId !== patch.action.stepId);
      const rerun = await runCapabilityWorkflow(plan, validation, { ...options, driftScenarios: remainingScenarios });
      const remaining = classifyFailures(plan, validation, rerun, capabilitiesById).filter((f) => f.stepId === finding.stepId);
      finalTrace = rerun;
      attempts.push({ classification: finding, patch, outcome: remaining.length === 0 ? 'auto_repaired' : 'wrong_patch' });
      continue;
    }

    // accept_enum_value / coerce_type: nothing about the HTTP exchange
    // changes — the fix is a knowledge-graph update, checked by
    // reclassifying the SAME trace against the patched capability record.
    const sourceCapabilityId = capabilityIdByStepId.get(patch.action.sourceStepId);
    const patchedCapabilities: ReadonlyMap<string, Capability> = sourceCapabilityId
      ? applyKnowledgePatch(capabilitiesById, patch.action, sourceCapabilityId)
      : capabilitiesById;
    const remaining = classifyFailures(plan, validation, initialTrace, patchedCapabilities).filter(
      (f) => f.stepId === finding.stepId && f.path === finding.path
    );
    attempts.push({ classification: finding, patch, outcome: remaining.length === 0 ? 'auto_repaired' : 'wrong_patch' });
  }

  return { scenario, initialTrace, finalTrace, attempts };
}

export function summarizeDetection(findings: Classification[], scenario: DriftScenario): boolean {
  return findings.some((f) => f.stepId === scenario.stepId || f.sourceStepId === scenario.stepId);
}
