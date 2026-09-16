import { describe, expect, it } from 'vitest';
import { computeWorkflowRisks } from '@/planner/risks';
import { presentPlan } from '@/planner/present';
import { validatePlan } from '@/planner/validator';
import type { WorkflowPlan } from '@/planner/schema';

const STRIPE_TO_GMAIL: WorkflowPlan = {
  execution_mode: 'deterministic',
  name: 'Email a receipt when a payment succeeds',
  description: 'test',
  steps: [
    { id: 'step_1', capability: 'stripe.payment_intent_succeeded', purpose: 'Detect the successful payment.' },
    { id: 'step_2', capability: 'gmail.send_message', purpose: 'Send the confirmation email.' },
  ],
  mappings: [
    { source: 'literal:me', destination: 'step_2.userId' },
    { source: 'step_1.data.object.receipt_email', destination: 'step_2.raw', transform: 'rfc822_base64url' },
  ],
};

describe('workflow risks', () => {
  it('flags a non-idempotent send as retry-unsafe, but never the trigger step', () => {
    const validation = validatePlan(STRIPE_TO_GMAIL);
    const risks = computeWorkflowRisks(presentPlan(STRIPE_TO_GMAIL, validation));

    expect(risks).toContainEqual(
      expect.objectContaining({ code: 'retry_unsafe', step_id: 'step_2', severity: 'high' })
    );
    expect(risks.some((r) => r.step_id === 'step_1')).toBe(false);
  });

  it('flags two steps hitting the same rate-limited provider', () => {
    const plan: WorkflowPlan = {
      execution_mode: 'deterministic',
      name: 'Two Stripe calls',
      description: 'test',
      steps: [
        { id: 'step_1', capability: 'stripe.create_customer', purpose: 'Create customer.' },
        { id: 'step_2', capability: 'stripe.create_payment_link', purpose: 'Create link.' },
      ],
      mappings: [],
    };
    const validation = validatePlan(plan);
    const risks = computeWorkflowRisks(presentPlan(plan, validation));

    expect(risks).toContainEqual(expect.objectContaining({ code: 'rate_limit_collision', severity: 'medium' }));
  });

  it('does not flag a single step against any provider', () => {
    const validation = validatePlan(STRIPE_TO_GMAIL);
    const risks = computeWorkflowRisks(presentPlan(STRIPE_TO_GMAIL, validation));
    expect(risks.some((r) => r.code === 'rate_limit_collision')).toBe(false);
  });
});
