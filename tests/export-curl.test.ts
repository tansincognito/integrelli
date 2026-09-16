import { describe, expect, it } from 'vitest';
import { generateCurlScript } from '@/planner/export-curl';
import { validatePlan } from '@/planner/validator';
import type { WorkflowPlan } from '@/planner/schema';

/** Real capabilities so the generator exercises real implementations/auth/schemas, not fixtures. */
const STRIPE_TO_GMAIL: WorkflowPlan = {
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
      source: 'template:To: {step_1.data.object.receipt_email}\nSubject: receipt\n\nThanks for your payment.',
      destination: 'step_2.raw',
      transform: 'rfc822_base64url',
    },
  ],
};

function generate(plan: WorkflowPlan): string {
  const validation = validatePlan(plan);
  expect(validation.valid).toBe(true);
  return generateCurlScript(plan, validation);
}

describe('curl export', () => {
  it('is syntactically valid bash', async () => {
    const script = generate(STRIPE_TO_GMAIL);
    const { execFileSync } = await import('node:child_process');
    const { writeFileSync, unlinkSync } = await import('node:fs');
    const tmp = `/tmp/integrelli-curl-export-test-${Date.now()}.sh`;
    writeFileSync(tmp, script);
    try {
      expect(() => execFileSync('bash', ['-n', tmp])).not.toThrow();
    } finally {
      unlinkSync(tmp);
    }
  });

  it('double-quotes the URL and headers so $VAR and $(jq ...) actually expand', () => {
    // Regression: these were single-quoted, which sends the literal text
    // "$GMAIL_ACCESS_TOKEN" instead of the credential's real value.
    const script = generate(STRIPE_TO_GMAIL);
    expect(script).toContain('-H "Authorization: Bearer $GMAIL_ACCESS_TOKEN"');
    expect(script).toContain('"https://gmail.googleapis.com/gmail/v1/users/me/messages/send"');
    expect(script).not.toContain("-H 'Authorization");
  });

  it('sources the trigger step from the script\'s first argument, not a curl call', () => {
    // Regression: event steps never got a response variable, so any mapping
    // referencing step_1 (the trigger) silently fell back to a placeholder
    // instead of a real jq extraction.
    const script = generate(STRIPE_TO_GMAIL);
    expect(script).toContain('STEP_1_RESPONSE=${1:?');
    expect(script).toContain(`echo "$STEP_1_RESPONSE" | jq -r '.data.object.receipt_email'`);
  });

  it('applies rfc822_base64url for real, not just a comment', () => {
    const script = generate(STRIPE_TO_GMAIL);
    expect(script).toMatch(/\| base64 \| tr -d '\\n' \| tr '\+\/' '-_' \| tr -d '='/);
  });

  it('quotes a PROVIDE_ placeholder so its multi-word message cannot be word-split', () => {
    const plan: WorkflowPlan = {
      execution_mode: 'deterministic',
      name: 'Post a Slack message',
      description: 'Posts a message to Slack with no channel mapped.',
      steps: [{ id: 'step_1', capability: 'slack.chat_post_message', purpose: 'Post.' }],
      mappings: [{ source: 'literal:hello', destination: 'step_1.text' }],
    };
    const validation = validatePlan(plan);
    // channel is required and unmapped — plan is invalid, which is fine; the export should still render it as a placeholder.
    expect(validation.errors.some((e) => e.code === 'unmapped_required_input')).toBe(true);
    const script = generateCurlScript(plan, validation);
    expect(script).toMatch(/--arg f\d+ "\$\{PROVIDE_STEP_1_CHANNEL:\?Set PROVIDE_STEP_1_CHANNEL/);
  });

  it('builds a nested jq path for a child field when only the child is mapped', () => {
    // Regression: a required container (hubspot.create_contact.properties)
    // whose own children are all individually optional used to become one
    // opaque PROVIDE_ blob even when a specific child (properties.email) was
    // actually mapped from an earlier step.
    const plan: WorkflowPlan = {
      execution_mode: 'deterministic',
      name: 'Create a HubSpot contact from a Stripe payment',
      description: 'test',
      steps: [
        { id: 'step_1', capability: 'stripe.payment_intent_succeeded', purpose: 'Detect payment.' },
        { id: 'step_2', capability: 'hubspot.create_contact', purpose: 'Create contact.' },
      ],
      mappings: [{ source: 'step_1.data.object.receipt_email', destination: 'step_2.properties.email' }],
    };
    const validation = validatePlan(plan);
    const script = generateCurlScript(plan, validation);
    expect(script).toContain('.properties.email = $');
    expect(script).not.toContain('PROVIDE_STEP_2_PROPERTIES:');
  });
});
