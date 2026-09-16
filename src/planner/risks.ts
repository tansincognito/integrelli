import type { PresentedStep } from './present';

/**
 * Structural risk signals computable from the plan alone — no execution
 * history needed, unlike latency or error-rate stats. Two checks, chosen
 * for being both real (backed by data already on the capability record) and
 * actionable (the message says what could go wrong, not just that something
 * might).
 */

export interface WorkflowRisk {
  severity: 'high' | 'medium';
  code: 'retry_unsafe' | 'rate_limit_collision';
  step_id: string;
  message: string;
}

const RETRY_UNSAFE_SIDE_EFFECTS = new Set(['create', 'update', 'delete', 'send']);

export function computeWorkflowRisks(steps: PresentedStep[]): WorkflowRisk[] {
  const risks: WorkflowRisk[] = [];

  for (const step of steps) {
    if (step.kind !== 'action') continue;
    if (step.idempotency.supported) continue;
    if (!RETRY_UNSAFE_SIDE_EFFECTS.has(step.side_effect)) continue;

    risks.push({
      severity: 'high',
      code: 'retry_unsafe',
      step_id: step.step_id,
      message: `${step.capability_id} has no idempotency mechanism — a retried request after a timeout or network error could ${describeSideEffect(step.side_effect)} twice.`,
    });
  }

  const stepsByProvider = new Map<string, PresentedStep[]>();
  for (const step of steps) {
    if (step.kind !== 'action') continue;
    const list = stepsByProvider.get(step.provider_id) ?? [];
    list.push(step);
    stepsByProvider.set(step.provider_id, list);
  }

  for (const [provider, providerSteps] of stepsByProvider) {
    if (providerSteps.length < 2) continue;
    const limited = providerSteps.find((step) => step.rate_limits?.requests !== undefined);
    if (!limited?.rate_limits) continue;

    const stepIds = providerSteps.map((step) => step.step_id).join(', ');
    risks.push({
      severity: 'medium',
      code: 'rate_limit_collision',
      step_id: providerSteps[0].step_id,
      message:
        `${providerSteps.length} steps (${stepIds}) all call ${provider}, whose documented limit is ` +
        `${limited.rate_limits.requests} requests / ${limited.rate_limits.window_seconds}s` +
        `${limited.rate_limits.note ? ` (${limited.rate_limits.note})` : ''} — fine run sequentially, but running this ` +
        'plan concurrently with other work against the same account could exceed it.',
    });
  }

  return risks;
}

function describeSideEffect(kind: string): string {
  switch (kind) {
    case 'create':
      return 'create the same record';
    case 'update':
      return 'apply the same update';
    case 'delete':
      return 'attempt the same delete';
    case 'send':
      return 'send the same message';
    default:
      return 'repeat the same effect';
  }
}
