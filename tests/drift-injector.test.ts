import { describe, expect, it } from 'vitest';
import { applyDrift, DriftInjectorAdapter } from '@/healing/drift-injector';
import type { DriftScenario } from '@/healing/types';
import type { HttpAdapter, RawHttpResponse } from '@/lib/exec/adapter';

const BASE_RESPONSE: RawHttpResponse = {
  status: 200,
  headers: {},
  body: { data: { object: { id: 'pi_1', receipt_email: 'a@example.com', status: 'succeeded' } } },
  latencyMs: 10,
};

describe('applyDrift', () => {
  it('renamed_field: moves the value to the new key, leaves it otherwise identical', () => {
    const scenario: DriftScenario = {
      id: 's1', class: 'renamed_field', stepId: 'step_1',
      field: 'data.object.receipt_email', renameTo: 'receipt_email_address', description: '',
    };
    const result = applyDrift(BASE_RESPONSE, scenario);
    const object = (result.body as any).data.object;
    expect(object.receipt_email).toBeUndefined();
    expect(object.receipt_email_address).toBe('a@example.com');
    expect(object.id).toBe('pi_1'); // untouched sibling
    expect(BASE_RESPONSE.body).not.toBe(result.body); // original never mutated
  });

  it('type_change: coerces the value at the same path', () => {
    const scenario: DriftScenario = {
      id: 's2', class: 'type_change', stepId: 'step_1',
      field: 'data.object.receipt_email', forceType: 'number', description: '',
    };
    const result = applyDrift(BASE_RESPONSE, scenario);
    expect((result.body as any).data.object.receipt_email).toBe(0); // Number("a@example.com") -> NaN -> 0
  });

  it('new_enum_value: overwrites the value with the injected one', () => {
    const scenario: DriftScenario = {
      id: 's3', class: 'new_enum_value', stepId: 'step_1',
      field: 'data.object.status', enumValue: 'disputed', description: '',
    };
    const result = applyDrift(BASE_RESPONSE, scenario);
    expect((result.body as any).data.object.status).toBe('disputed');
  });

  it('expired_token: overrides status and body regardless of the base response', () => {
    const scenario: DriftScenario = { id: 's4', class: 'expired_token', stepId: 'step_1', description: '' };
    const result = applyDrift(BASE_RESPONSE, scenario);
    expect(result.status).toBe(401);
  });

  it('removed_endpoint: overrides status and body regardless of the base response', () => {
    const scenario: DriftScenario = { id: 's5', class: 'removed_endpoint', stepId: 'step_1', description: '' };
    const result = applyDrift(BASE_RESPONSE, scenario);
    expect(result.status).toBe(404);
  });

  it('leaves the response untouched when the target field does not exist', () => {
    const scenario: DriftScenario = {
      id: 's6', class: 'renamed_field', stepId: 'step_1',
      field: 'data.object.nonexistent', renameTo: 'whatever', description: '',
    };
    expect(applyDrift(BASE_RESPONSE, scenario)).toEqual(BASE_RESPONSE);
  });
});

describe('DriftInjectorAdapter', () => {
  const baseAdapter: HttpAdapter = {
    mode: 'test',
    async send() {
      return { ...BASE_RESPONSE };
    },
  };

  it('only mutates the step a scenario targets', async () => {
    const scenario: DriftScenario = { id: 's1', class: 'expired_token', stepId: 'step_2', description: '' };
    const adapter = new DriftInjectorAdapter(baseAdapter, [scenario]);

    const untouched = await adapter.send({ method: 'GET', url: '', headers: {}, query: {}, body: null }, { stepId: 'step_1', attempt: 1, seed: 's' });
    expect(untouched.status).toBe(200);

    const drifted = await adapter.send({ method: 'GET', url: '', headers: {}, query: {}, body: null }, { stepId: 'step_2', attempt: 1, seed: 's' });
    expect(drifted.status).toBe(401);
  });

  it('passes through unchanged when no scenario is configured', async () => {
    const adapter = new DriftInjectorAdapter(baseAdapter, []);
    const result = await adapter.send({ method: 'GET', url: '', headers: {}, query: {}, body: null }, { stepId: 'step_1', attempt: 1, seed: 's' });
    expect(result).toEqual(BASE_RESPONSE);
  });
});
