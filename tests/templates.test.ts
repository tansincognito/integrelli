import { describe, expect, it } from 'vitest';
import { byId } from '@/knowledge';
import { WorkflowPlanSchema } from '@/schemas/workflow.zod';
import { BUILTIN_TEMPLATES } from '@/templates';

describe('BUILTIN_TEMPLATES', () => {
  it('has exactly 4 templates, including the headline ElevenLabs -> Stripe -> Gmail demo', () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(4);
    expect(BUILTIN_TEMPLATES.some((t) => t.id === 'elevenlabs-stripe-gmail')).toBe(true);
  });

  for (const template of [
    { id: 'elevenlabs-stripe-gmail' },
    { id: 'call-to-notion-slack' },
    { id: 'stripe-receipt-sms' },
    { id: 'openai-summary-email' },
  ]) {
    it(`"${template.id}" parses against the real plan Zod schema`, () => {
      const found = BUILTIN_TEMPLATES.find((t) => t.id === template.id);
      expect(found).toBeDefined();
      const result = WorkflowPlanSchema.safeParse(found!.plan);
      expect(result.success).toBe(true);
    });
  }

  it('every step in every template references a real endpointId from the knowledge pack', () => {
    for (const template of BUILTIN_TEMPLATES) {
      for (const step of template.plan.steps) {
        expect(byId.has(step.endpointId), `${template.id}: unknown endpointId "${step.endpointId}"`).toBe(true);
      }
    }
  });

  it('every $steps.<id> reference in every template points backward to a step that actually exists', () => {
    for (const template of BUILTIN_TEMPLATES) {
      const stepIds = template.plan.steps.map((s) => s.id);
      template.plan.steps.forEach((step, index) => {
        const earlierIds = new Set(stepIds.slice(0, index));
        for (const mapping of step.mappings) {
          if (mapping.source.kind !== 'ref') continue;
          const match = /^\$steps\.([^.]+)\./.exec(mapping.source.expression);
          if (!match) continue; // $trigger.* refs are not step references
          const refStepId = match[1];
          expect(
            earlierIds.has(refStepId),
            `${template.id}/${step.id}: "${mapping.source.expression}" does not reference an earlier step`
          ).toBe(true);
        }
      });
    }
  });

  it('has non-empty steps for every template and step ids follow the step_N format in order', () => {
    for (const template of BUILTIN_TEMPLATES) {
      expect(template.plan.steps.length).toBeGreaterThan(0);
      template.plan.steps.forEach((step, index) => {
        expect(step.id).toBe(`step_${index + 1}`);
      });
    }
  });
});
