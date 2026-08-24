import { describe, it, expect } from 'vitest';
import type { WorkflowPlan } from '@/types';
import { serializePlan, parseWorkflowFile } from '@/lib/io/workflow-file';

function fixturePlan(): WorkflowPlan {
  return {
    version: 1,
    id: 'plan_1',
    name: 'Call to Stripe payment link',
    description: 'On call completion, create a Stripe payment link and email it.',
    prompt: 'When an ElevenLabs call completes, create a Stripe payment link and email it via Gmail.',
    trigger: {
      service: 'elevenlabs',
      eventName: 'elevenlabs.call.completed',
      description: 'Fires when an ElevenLabs conversational call finishes.',
      payloadSchema: {
        type: 'object',
        required: ['call_id'],
        properties: {
          call_id: { type: 'string' },
        },
      },
      samplePayload: { call_id: 'call_123' },
    },
    steps: [
      {
        id: 'step_1',
        order: 0,
        endpointId: 'stripe.create_payment_link',
        title: 'Create payment link',
        rationale: 'Turn the completed call into a payable invoice.',
        mappings: [
          {
            path: 'line_items[0].price',
            target: 'body',
            source: { kind: 'literal', value: 'price_123' },
            required: true,
          },
          {
            path: 'Authorization',
            target: 'header',
            source: { kind: 'secret', envVar: 'STRIPE_API_KEY' },
            required: true,
          },
          {
            path: 'note',
            target: 'body',
            source: { kind: 'ref', expression: '$trigger.payload.call_id' },
            required: false,
          },
          {
            path: 'unused',
            target: 'body',
            source: { kind: 'unresolved', reason: 'No mapping supplied by the model.' },
            required: false,
          },
        ],
      },
    ],
    issues: [
      {
        severity: 'warning',
        stepId: 'step_1',
        code: 'unresolved_required_field',
        message: 'Field "unused" left unresolved.',
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('workflow-file: serialize/parse round-trip', () => {
  it('preserves the plan exactly through export -> import', () => {
    const plan = fixturePlan();
    const serialized = serializePlan(plan);
    const result = parseWorkflowFile(serialized);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan).toEqual(plan);
    }
  });

  it('returns a structured error for invalid JSON instead of throwing', () => {
    expect(() => parseWorkflowFile('{ not valid json')).not.toThrow();
    const result = parseWorkflowFile('{ not valid json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Invalid JSON/);
    }
  });

  it('returns a structured error for JSON that fails schema validation', () => {
    const malformed = JSON.stringify({ version: 1, id: 'x' });
    expect(() => parseWorkflowFile(malformed)).not.toThrow();
    const result = parseWorkflowFile(malformed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/schema/i);
    }
  });
});
