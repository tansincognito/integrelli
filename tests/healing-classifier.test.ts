import { describe, expect, it } from 'vitest';
import type { Capability } from '@/knowledge/capability';
import type { WorkflowPlan } from '@/planner/schema';
import type { PlanValidation, ResolvedMapping } from '@/planner/validator';
import type { ExecutionTrace, StepResult } from '@/types/execution';
import { classifyFailures } from '@/healing/classifier';
import { proposePatch } from '@/healing/patch';

/**
 * Unit-level classifier coverage using hand-built fixtures (not the real
 * ingested store) so each case is deterministic and independent of what any
 * particular provider's schema happens to contain — see self-healing.test.ts
 * for the real-capability integration happy paths per failure class.
 */

function capability(overrides: Partial<Capability> & Pick<Capability, 'id' | 'outputs'>): Capability {
  return {
    provider_id: 'test',
    api_version_id: 'test@1',
    kind: 'event',
    name: overrides.id.split('.')[1] ?? 'test',
    description: 'test capability',
    category: 'other',
    inputs: [],
    authentication: { kind: 'none' },
    permissions: [],
    rate_limits: null,
    idempotency: { supported: false },
    side_effects: { kind: 'read', description: '', reversible: true },
    source: { document_source_id: 'test', pointer: '', extractor: 'openapi', extracted_at: '2026-01-01' },
    confidence: 1,
    last_verified: '2026-01-01',
    ...overrides,
  };
}

function step(overrides: Partial<StepResult> & Pick<StepResult, 'stepId' | 'endpointId'>): StepResult {
  return {
    status: 'success',
    request: { method: 'GET', url: '', headers: {}, query: {}, body: null },
    attempts: [],
    finalStatus: 200,
    totalDurationMs: 0,
    startedAtOffsetMs: 0,
    responseBody: null,
    issues: [],
    ...overrides,
  };
}

function mapping(overrides: Partial<ResolvedMapping> & Pick<ResolvedMapping, 'destination_step_id'>): ResolvedMapping {
  return {
    source: '',
    destination: '',
    source_kind: 'field',
    destination_path: 'x',
    ...overrides,
  };
}

const PLAN: WorkflowPlan = {
  execution_mode: 'deterministic',
  name: 'synthetic',
  description: '',
  steps: [
    { id: 'step_1', capability: 'source.event', purpose: '' },
    { id: 'step_2', capability: 'dest.action', purpose: '' },
  ],
  mappings: [],
};

describe('classifyFailures: field-level heuristics', () => {
  it('prefers a semantic-type match over a same-JS-type fallback', () => {
    const source = capability({
      id: 'source.event',
      outputs: [{ path: 'data.email', name: 'email', type: 'string', required: false, semantic_type: 'email' }],
    });
    const capabilitiesById = new Map([['source.event', source]]);
    const validation: PlanValidation = {
      valid: true, errors: [], warnings: [],
      resolved_mappings: [mapping({ destination_step_id: 'step_2', source_step_id: 'step_1', source_path: 'data.email', source: 'step_1.data.email' })],
    };
    const trace: ExecutionTrace = {
      traceId: 't', planId: 'p', mode: 'test', seed: 's', faults: [], totalDurationMs: 0, finishedAt: null,
      status: 'partial',
      steps: [
        step({
          stepId: 'step_1', endpointId: 'source.event',
          // "code" (not email-shaped, string type) comes before "contact_email" in
          // iteration order — a naive first-string-match fallback would pick "code".
          responseBody: { data: { code: 'abc', contact_email: 'user@example.com' } },
        }),
        step({ stepId: 'step_2', endpointId: 'dest.action', status: 'skipped', finalStatus: null }),
      ],
    };

    const findings = classifyFailures(PLAN, validation, trace, capabilitiesById);
    expect(findings).toHaveLength(1);
    expect(findings[0].class).toBe('renamed_field');
    expect(findings[0].candidatePath).toBe('data.contact_email');
  });

  it('finds no candidate (and the patch escalates) when nothing shares the type', () => {
    const source = capability({
      id: 'source.event',
      outputs: [{ path: 'data.active', name: 'active', type: 'boolean', required: false, semantic_type: 'boolean_flag' }],
    });
    const capabilitiesById = new Map([['source.event', source]]);
    const validation: PlanValidation = {
      valid: true, errors: [], warnings: [],
      resolved_mappings: [mapping({ destination_step_id: 'step_2', source_step_id: 'step_1', source_path: 'data.active', source: 'step_1.data.active' })],
    };
    const trace: ExecutionTrace = {
      traceId: 't', planId: 'p', mode: 'test', seed: 's', faults: [], totalDurationMs: 0, finishedAt: null,
      status: 'partial',
      steps: [
        step({ stepId: 'step_1', endpointId: 'source.event', responseBody: { data: { id: 'x1', name: 'n' } } }),
        step({ stepId: 'step_2', endpointId: 'dest.action', status: 'skipped', finalStatus: null }),
      ],
    };

    const findings = classifyFailures(PLAN, validation, trace, capabilitiesById);
    expect(findings).toHaveLength(1);
    expect(findings[0].candidatePath).toBeUndefined();
    expect(findings[0].confidence).toBeLessThan(0.5);

    const patch = proposePatch(findings[0]);
    expect(patch.action.kind).toBe('escalate');
  });

  it('does not double-report a step already explained by a 401/404', () => {
    const source = capability({
      id: 'source.event',
      outputs: [{ path: 'data.email', name: 'email', type: 'string', required: false, semantic_type: 'email' }],
    });
    const capabilitiesById = new Map([['source.event', source]]);
    const validation: PlanValidation = {
      valid: true, errors: [], warnings: [],
      resolved_mappings: [mapping({ destination_step_id: 'step_2', source_step_id: 'step_1', source_path: 'data.email', source: 'step_1.data.email' })],
    };
    const trace: ExecutionTrace = {
      traceId: 't', planId: 'p', mode: 'test', seed: 's', faults: [], totalDurationMs: 0, finishedAt: null,
      status: 'failed',
      steps: [
        step({ stepId: 'step_1', endpointId: 'source.event', responseBody: { data: {} } }),
        step({ stepId: 'step_2', endpointId: 'dest.action', status: 'failed', finalStatus: 401 }),
      ],
    };

    const findings = classifyFailures(PLAN, validation, trace, capabilitiesById);
    expect(findings).toHaveLength(1);
    expect(findings[0].class).toBe('expired_token');
  });
});
