import { describe, expect, it } from 'vitest';
import type { WorkflowPlan } from '@/planner/schema';
import { validatePlan } from '@/planner/validator';
import { runCapabilityWorkflow } from '@/lib/exec/capability-engine';

/**
 * Regression guard for the capability-graph execution path (parallel to
 * tests/templates-exec.test.ts, which covers the old EndpointSpec pack).
 * stripe.create_customer -> gmail.send_message exercises all three mapping
 * resolution branches: a literal into a path param, a field-to-field
 * mapping between two capabilities' schemas, and a literal transformed via
 * `rfc822_base64url` into a required body field.
 */
const PLAN: WorkflowPlan = {
  execution_mode: 'deterministic',
  name: 'stripe-to-gmail-test',
  description: 'Create a Stripe customer and notify them by Gmail.',
  steps: [
    { id: 'step_1', capability: 'stripe.create_customer', purpose: 'Create the customer record.' },
    { id: 'step_2', capability: 'gmail.send_message', purpose: 'Notify the customer by email.' },
  ],
  mappings: [
    { source: 'literal:me', destination: 'step_2.userId' },
    { source: 'step_1.id', destination: 'step_2.threadId' },
    {
      source: 'literal:To: customer@example.com\r\nSubject: Welcome\r\n\r\nThanks for signing up.',
      destination: 'step_2.raw',
      transform: 'rfc822_base64url',
    },
  ],
};

const SEEDS = ['integrelli', 'abc', 'seed1', 'seed2', 'seed3', 'xyz', '0', 'a'];

describe('stripe -> gmail plan validates against the ingested capability graph', () => {
  it('is valid with no errors', () => {
    const validation = validatePlan(PLAN);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
  });
});

describe('capability-graph plan executes cleanly across seeds', () => {
  for (const seed of SEEDS) {
    it(`succeeds with seed "${seed}"`, async () => {
      const validation = validatePlan(PLAN);
      const trace = await runCapabilityWorkflow(PLAN, validation, { seed, faults: [] });

      expect(trace.status).toBe('success');
      expect(trace.steps).toHaveLength(PLAN.steps.length);
      for (const step of trace.steps) {
        expect(step.status).toBe('success');
      }
    });
  }
});
