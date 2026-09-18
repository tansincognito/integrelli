import { describe, expect, it } from 'vitest';
import type { WorkflowPlan } from '@/planner/schema';
import { validatePlan } from '@/planner/validator';
import { runSelfHealing } from '@/healing/repair-loop';
import type { DriftScenario } from '@/healing/types';

/**
 * End-to-end self-healing coverage: inject each of the 5 failure classes
 * (project brief's taxonomy) against the real ingested Stripe/Gmail
 * capabilities, and check detection -> classification -> patch ->
 * re-run/-classify lands on the expected outcome. This is the eval harness's
 * unit-level counterpart — tests/fixtures/drift-scenarios.ts + a future
 * `npm run eval:drift` script turn the same primitives into the aggregate
 * detection/classification/repair-rate numbers the project brief asks for.
 */
const PLAN: WorkflowPlan = {
  execution_mode: 'deterministic',
  name: 'healing-test-plan',
  description: 'Email a receipt when a payment succeeds.',
  steps: [
    { id: 'step_1', capability: 'stripe.payment_intent_succeeded', purpose: 'Detect the successful payment.' },
    { id: 'step_2', capability: 'gmail.send_message', purpose: 'Send the confirmation email.' },
  ],
  mappings: [
    { source: 'literal:me', destination: 'step_2.userId' },
    { source: 'step_1.data.object.receipt_email', destination: 'step_2.raw', transform: 'rfc822_base64url' },
    { source: 'step_1.data.object.status', destination: 'step_2.snippet' },
  ],
};

const VALIDATION = validatePlan(PLAN);

function run(scenario: DriftScenario) {
  return runSelfHealing(PLAN, VALIDATION, { seed: 'healing-seed', mode: 'test', faults: [], driftScenarios: [scenario] }, scenario);
}

describe('self-healing: plan validity', () => {
  it('the fixture plan validates cleanly', () => {
    expect(VALIDATION.valid).toBe(true);
    expect(VALIDATION.errors).toEqual([]);
  });
});

describe('self-healing: renamed_field', () => {
  it('detects, classifies, remaps, and auto-repairs', async () => {
    const scenario: DriftScenario = {
      id: 'renamed_field_1', class: 'renamed_field', stepId: 'step_1',
      field: 'data.object.receipt_email', renameTo: 'receipt_email_address',
      description: 'Stripe renames receipt_email to receipt_email_address.',
    };
    const result = await run(scenario);
    expect(result.attempts).toHaveLength(1);
    const [attempt] = result.attempts;
    expect(attempt.classification.class).toBe('renamed_field');
    expect(attempt.classification.candidatePath).toBe('data.object.receipt_email_address');
    expect(attempt.patch.action).toMatchObject({ kind: 'remap_field', toPath: 'data.object.receipt_email_address' });
    expect(attempt.outcome).toBe('auto_repaired');
  });

});

describe('self-healing: type_change', () => {
  it('detects a type mismatch against the capability graph and auto-repairs via a knowledge patch', async () => {
    const scenario: DriftScenario = {
      id: 'type_change_1', class: 'type_change', stepId: 'step_1',
      field: 'data.object.receipt_email', forceType: 'number',
      description: 'receipt_email starts coming back as a number.',
    };
    const result = await run(scenario);
    const [attempt] = result.attempts;
    expect(attempt.classification.class).toBe('type_change');
    expect(attempt.patch.action).toMatchObject({ kind: 'coerce_type', toType: 'number' });
    expect(attempt.outcome).toBe('auto_repaired');
    // No re-execution needed for this class — the fix is a graph update, not a mapping change.
    expect(result.finalTrace).toBe(result.initialTrace);
  });
});

describe('self-healing: new_enum_value', () => {
  it('detects a value outside the declared enum and widens it', async () => {
    const scenario: DriftScenario = {
      id: 'new_enum_1', class: 'new_enum_value', stepId: 'step_1',
      field: 'data.object.status', enumValue: 'disputed',
      description: 'Stripe ships a new PaymentIntent status.',
    };
    const result = await run(scenario);
    const [attempt] = result.attempts;
    expect(attempt.classification.class).toBe('new_enum_value');
    expect(attempt.patch.action).toMatchObject({ kind: 'accept_enum_value', value: 'disputed' });
    expect(attempt.outcome).toBe('auto_repaired');
  });

  it('does not misfire when the value is already in the declared enum', async () => {
    const scenario: DriftScenario = {
      id: 'new_enum_2', class: 'new_enum_value', stepId: 'step_1',
      field: 'data.object.status', enumValue: 'processing', // a real, already-declared value
      description: 'Not actually drift.',
    };
    const result = await run(scenario);
    expect(result.attempts).toHaveLength(0);
  });
});

describe('self-healing: expired_token', () => {
  it('detects a 401, proposes a refresh, and auto-repairs on retry', async () => {
    const scenario: DriftScenario = { id: 'expired_1', class: 'expired_token', stepId: 'step_2', description: 'Gmail token expired.' };
    const result = await run(scenario);
    const [attempt] = result.attempts;
    expect(attempt.classification.class).toBe('expired_token');
    expect(attempt.patch.action.kind).toBe('refresh_token');
    expect(attempt.outcome).toBe('auto_repaired');
    expect(result.finalTrace.steps.find((s) => s.stepId === 'step_2')?.status).toBe('success');
  });
});

describe('self-healing: removed_endpoint', () => {
  it('detects a 404 and always escalates rather than guessing a replacement', async () => {
    const scenario: DriftScenario = { id: 'removed_1', class: 'removed_endpoint', stepId: 'step_2', description: 'Gmail send endpoint retired.' };
    const result = await run(scenario);
    const [attempt] = result.attempts;
    expect(attempt.classification.class).toBe('removed_endpoint');
    expect(attempt.patch.action.kind).toBe('escalate');
    expect(attempt.outcome).toBe('escalated');
  });
});

describe('self-healing: no drift', () => {
  it('finds nothing to repair on a clean run', async () => {
    const trace = await run({ id: 'noop', class: 'renamed_field', stepId: 'nonexistent-step', description: '' } as DriftScenario);
    expect(trace.attempts).toHaveLength(0);
    expect(trace.initialTrace.status).toBe('success');
  });
});
