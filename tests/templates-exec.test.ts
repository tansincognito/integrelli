import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES } from '@/templates';
import { runWorkflow } from '@/lib/exec/engine';

/**
 * Regression guard: a template whose mapping references an OPTIONAL response
 * field succeeds or fails depending on the seed, because the mock generator
 * emits optional properties probabilistically. Every referenced path must sit
 * on a `required` chain in the target endpoint's responseSchema.
 */
const SEEDS = ['integrelli', 'abc', 'seed1', 'seed2', 'seed3', 'xyz', '0', 'a'];

describe('builtin templates execute cleanly across seeds', () => {
  for (const template of BUILTIN_TEMPLATES) {
    for (const seed of SEEDS) {
      it(`${template.id} succeeds with seed "${seed}"`, async () => {
        const trace = await runWorkflow(template.plan, { seed, mode: 'test', faults: [] });

        expect(trace.status).toBe('success');
        expect(trace.steps).toHaveLength(template.plan.steps.length);
        for (const step of trace.steps) {
          expect(step.status).toBe('success');
          expect(step.issues ?? []).toEqual([]);
        }
      });
    }
  }
});
