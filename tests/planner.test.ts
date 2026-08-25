import { describe, expect, it } from 'vitest';
import { extractIntent } from '@/planner/intent';
import { validatePlan } from '@/planner/validator';
import { retrieveForRequest } from '@/planner';
import type { WorkflowPlan } from '@/planner/schema';

/** The Day 1 acceptance workflow: a Stripe payment event feeding a Gmail send. */
const VALID_PLAN: WorkflowPlan = {
  execution_mode: 'deterministic',
  name: 'Email a receipt when a payment succeeds',
  description: 'When Stripe reports a successful payment, send the customer a confirmation email through Gmail.',
  steps: [
    { id: 'step_1', capability: 'stripe.payment_intent_succeeded', purpose: 'Detect the successful payment.' },
    { id: 'step_2', capability: 'gmail.send_message', purpose: 'Send the confirmation email.' },
  ],
  mappings: [
    { source: 'literal:me', destination: 'step_2.userId' },
    {
      source: 'step_1.data.object.receipt_email',
      destination: 'step_2.raw',
      transform: 'rfc822_base64url',
    },
  ],
};

function planWith(overrides: Partial<WorkflowPlan>): WorkflowPlan {
  return { ...VALID_PLAN, ...overrides };
}

describe('intent extraction', () => {
  it('splits a trigger clause from its action clauses', () => {
    const intent = extractIntent('When a Stripe payment succeeds, send an email through Gmail.');
    expect(intent.clauses).toHaveLength(2);
    expect(intent.clauses[0].role).toBe('trigger');
    expect(intent.clauses[1].role).toBe('action');
  });

  it('detects providers per clause and across the whole request', () => {
    const intent = extractIntent('When a Stripe payment succeeds, send an email through Gmail.');
    expect(intent.clauses[0].provider_hints).toEqual(['stripe']);
    expect(intent.clauses[1].provider_hints).toEqual(['gmail']);
    expect(intent.provider_hints.sort()).toEqual(['gmail', 'stripe']);
  });

  it('treats a request with no trigger word as all actions', () => {
    const intent = extractIntent('Create a Stripe payment link and post it to Slack');
    expect(intent.clauses.every((clause) => clause.role === 'action')).toBe(true);
  });

  it('handles a single-clause request', () => {
    const intent = extractIntent('create a payment link');
    expect(intent.clauses).toHaveLength(1);
    expect(intent.clauses[0].text).toBe('create a payment link');
  });
});

describe('plan validation', () => {
  it('accepts a structurally sound plan', () => {
    const validation = validatePlan(VALID_PLAN);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
    expect(validation.resolved_mappings).toHaveLength(2);
  });

  it('resolves capability-qualified references as well as step-qualified ones', () => {
    const validation = validatePlan(
      planWith({
        mappings: [
          { source: 'literal:me', destination: 'gmail.send_message.userId' },
          {
            source: 'stripe.payment_intent_succeeded.data.object.receipt_email',
            destination: 'gmail.send_message.raw',
            transform: 'rfc822_base64url',
          },
        ],
      })
    );

    expect(validation.valid).toBe(true);
    expect(validation.resolved_mappings[1].source_step_id).toBe('step_1');
    expect(validation.resolved_mappings[1].destination_path).toBe('raw');
  });

  it('rejects a plan that is not the right shape at all', () => {
    const validation = validatePlan({ steps: 'lots of them' });
    expect(validation.valid).toBe(false);
    expect(validation.errors.every((error) => error.code === 'schema_invalid')).toBe(true);
  });

  it('rejects a capability that does not exist', () => {
    const validation = validatePlan(
      planWith({
        steps: [
          { id: 'step_1', capability: 'stripe.payment_intent_succeeded', purpose: 'Detect.' },
          { id: 'step_2', capability: 'gmail.send_sms', purpose: 'Send.' },
        ],
      })
    );
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.code === 'unknown_capability')).toBe(true);
  });

  it('rejects a field that the capability does not have', () => {
    const validation = validatePlan(
      planWith({
        mappings: [
          { source: 'literal:me', destination: 'step_2.userId' },
          { source: 'step_1.data.object.nonexistent_field', destination: 'step_2.raw' },
        ],
      })
    );
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.code === 'unknown_source_field')).toBe(true);
  });

  it('rejects a mapping into an input that does not exist', () => {
    const validation = validatePlan(
      planWith({
        mappings: [
          { source: 'literal:me', destination: 'step_2.userId' },
          { source: 'literal:hello', destination: 'step_2.to' },
          { source: 'literal:body', destination: 'step_2.raw' },
        ],
      })
    );
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.code === 'unknown_destination_field')).toBe(true);
  });

  it('rejects a required input that nothing supplies', () => {
    const validation = validatePlan(
      planWith({
        mappings: [{ source: 'literal:me', destination: 'step_2.userId' }],
      })
    );
    expect(validation.valid).toBe(false);
    expect(
      validation.errors.some((error) => error.code === 'unmapped_required_input' && error.message.includes('raw'))
    ).toBe(true);
  });

  it('rejects a reference to a later step', () => {
    const validation = validatePlan(
      planWith({
        steps: [
          { id: 'step_1', capability: 'stripe.get_customer', purpose: 'Look up the customer.' },
          { id: 'step_2', capability: 'stripe.create_refund', purpose: 'Refund the payment.' },
        ],
        mappings: [
          { source: 'step_2.payment_intent', destination: 'step_1.customer' },
          { source: 'literal:pi_123', destination: 'step_2.payment_intent' },
        ],
      })
    );
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.code === 'forward_reference')).toBe(true);
  });

  it('rejects an event used anywhere but the first step', () => {
    const validation = validatePlan(
      planWith({
        steps: [
          { id: 'step_1', capability: 'gmail.send_message', purpose: 'Send.' },
          { id: 'step_2', capability: 'stripe.payment_intent_succeeded', purpose: 'Detect.' },
        ],
        mappings: [
          { source: 'literal:me', destination: 'step_1.userId' },
          { source: 'literal:body', destination: 'step_1.raw' },
        ],
      })
    );
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.code === 'event_not_first')).toBe(true);
  });

  it('rejects step ids that are out of order', () => {
    const validation = validatePlan(
      planWith({
        steps: [
          { id: 'step_2', capability: 'stripe.payment_intent_succeeded', purpose: 'Detect.' },
          { id: 'step_1', capability: 'gmail.send_message', purpose: 'Send.' },
        ],
      })
    );
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.code === 'step_ids_not_sequential')).toBe(true);
  });

  it('rejects an unsupported execution mode', () => {
    const validation = validatePlan({ ...VALID_PLAN, execution_mode: 'agentic' });
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.code === 'schema_invalid')).toBe(true);
  });

  it('rejects a semantically incompatible mapping even when both fields are strings', () => {
    const validation = validatePlan({
      execution_mode: 'deterministic',
      name: 'Bad wiring',
      description: 'Writes an email address into a URL field.',
      steps: [
        { id: 'step_1', capability: 'stripe.create_customer', purpose: 'Create the customer.' },
        { id: 'step_2', capability: 'stripe.create_checkout_session', purpose: 'Start checkout.' },
      ],
      mappings: [
        { source: 'literal:payment', destination: 'step_2.mode' },
        { source: 'literal:[]', destination: 'step_2.line_items' },
        { source: 'step_1.email', destination: 'step_2.success_url' },
      ],
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.code === 'incompatible_types')).toBe(true);
  });

  it('warns rather than fails when a value is coerced without a declared transform', () => {
    const validation = validatePlan(
      planWith({
        mappings: [
          { source: 'literal:me', destination: 'step_2.userId' },
          { source: 'step_1.data.object.receipt_email', destination: 'step_2.raw' },
        ],
      })
    );

    expect(validation.valid).toBe(true);
    expect(validation.warnings.some((warning) => warning.code === 'transform_recommended')).toBe(true);
  });

  it('warns when a plan leans on a capability that has never been cross-checked', () => {
    const validation = validatePlan({
      execution_mode: 'deterministic',
      name: 'Create a contact',
      description: 'Creates a HubSpot contact.',
      steps: [{ id: 'step_1', capability: 'hubspot.create_contact', purpose: 'Create the contact.' }],
      mappings: [
        { source: 'literal:{}', destination: 'step_1.properties' },
        { source: 'literal:a@b.com', destination: 'step_1.properties.email' },
      ],
    });

    expect(validation.valid).toBe(true);
    expect(validation.warnings.some((warning) => warning.code === 'low_confidence_capability')).toBe(true);
  });

  it('flags a capability the planner used without it having been retrieved', () => {
    const validation = validatePlan(VALID_PLAN, { candidateIds: ['gmail.send_message'] });
    expect(
      validation.warnings.some(
        (warning) => warning.code === 'capability_not_in_candidates' && warning.step_id === 'step_1'
      )
    ).toBe(true);
  });
});

describe('Day 1 acceptance path', () => {
  const REQUEST = 'When a Stripe payment succeeds, send an email through Gmail.';

  it('retrieves both halves of the workflow from a single request', async () => {
    const { candidates } = await retrieveForRequest(REQUEST);
    const ids = candidates.map((candidate) => candidate.capability_id);

    expect(ids).toContain('stripe.payment_intent_succeeded');
    expect(ids).toContain('gmail.send_message');
  });

  it('validates the resulting workflow against the capability graph', () => {
    const validation = validatePlan(VALID_PLAN);
    expect(validation.valid).toBe(true);
    expect(validation.resolved_mappings.map((mapping) => mapping.destination_path).sort()).toEqual(['raw', 'userId']);
  });
});
