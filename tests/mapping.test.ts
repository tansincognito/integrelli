import { describe, expect, it } from 'vitest';
import { parseRef, isForwardReference, type StepRef } from '@/lib/mapping/ref';
import { composeRequest, type ResolvedMapping } from '@/lib/mapping/compose';
import { resolveStepMappings, type ResolveContext } from '@/lib/mapping/resolve';
import { validateRequestBody } from '@/lib/mapping/validate';
import type { FieldMapping, WorkflowStep } from '@/types/workflow';

describe('mapping/ref', () => {
  it('parses a valid $trigger.payload ref', () => {
    const result = parseRef('$trigger.payload.call_id');
    expect(result).toEqual({ ok: true, ref: { kind: 'trigger', path: 'call_id' } });
  });

  it('parses a valid $steps.<id>.response ref, including array indices', () => {
    const result = parseRef('$steps.step_1.response.line_items[0].price');
    expect(result).toEqual({
      ok: true,
      ref: { kind: 'step', stepId: 'step_1', path: 'line_items[0].price' },
    });
  });

  it('rejects an expression that does not start with "$"', () => {
    const result = parseRef('trigger.payload.foo');
    expect(result.ok).toBe(false);
  });

  it('rejects an unrecognized grammar', () => {
    const result = parseRef('$trigger.headers.foo');
    expect(result.ok).toBe(false);
  });

  it('flags a self-reference as a forward reference', () => {
    const ref: StepRef = { kind: 'step', stepId: 'step_1', path: 'id' };
    expect(isForwardReference(ref, 'step_1', new Set(['step_0']))).toBe(true);
  });

  it('flags a reference to a step not yet established as earlier', () => {
    const ref: StepRef = { kind: 'step', stepId: 'step_2', path: 'id' };
    expect(isForwardReference(ref, 'step_1', new Set(['step_0']))).toBe(true);
  });

  it('allows a reference to a genuinely earlier step', () => {
    const ref: StepRef = { kind: 'step', stepId: 'step_1', path: 'id' };
    expect(isForwardReference(ref, 'step_2', new Set(['step_1']))).toBe(false);
  });
});

describe('mapping/compose', () => {
  it('composes flat mappings into a nested body, plus flat header/query/path maps', () => {
    const resolved: ResolvedMapping[] = [
      {
        mapping: { path: 'line_items[0].price', target: 'body', required: true, source: { kind: 'literal', value: 'price_123' } },
        value: 'price_123',
      },
      {
        mapping: { path: 'line_items[0].quantity', target: 'body', required: true, source: { kind: 'literal', value: 2 } },
        value: 2,
      },
      {
        mapping: { path: 'after_completion.type', target: 'body', required: false, source: { kind: 'literal', value: 'hosted_confirmation' } },
        value: 'hosted_confirmation',
      },
      {
        mapping: { path: 'X-Trace-Id', target: 'header', required: false, source: { kind: 'literal', value: 'abc' } },
        value: 'abc',
      },
      {
        mapping: { path: 'limit', target: 'query', required: false, source: { kind: 'literal', value: 10 } },
        value: 10,
      },
      {
        mapping: { path: 'userId', target: 'path', required: true, source: { kind: 'literal', value: 'me' } },
        value: 'me',
      },
    ];

    const composed = composeRequest(resolved);

    expect(composed.body).toEqual({
      line_items: [{ price: 'price_123', quantity: 2 }],
      after_completion: { type: 'hosted_confirmation' },
    });
    expect(composed.headers).toEqual({ 'X-Trace-Id': 'abc' });
    expect(composed.query).toEqual({ limit: '10' });
    expect(composed.path).toEqual({ userId: 'me' });
  });

  it('returns a null body when there are no body mappings', () => {
    const composed = composeRequest([]);
    expect(composed.body).toBeNull();
  });
});

describe('mapping/resolve', () => {
  const baseStep: WorkflowStep = {
    id: 'step_2',
    order: 1,
    endpointId: 'slack.post_message',
    title: 'Post to Slack',
    rationale: 'notify the team',
    mappings: [],
  };

  function ctxWith(overrides: Partial<ResolveContext> = {}): ResolveContext {
    return {
      triggerPayload: { call_id: 'call_123' },
      stepResponses: new Map([['step_1', { ts: '1716239022.123456' }]]),
      earlierStepIds: new Set(['step_1']),
      currentStepId: 'step_2',
      ...overrides,
    };
  }

  it('resolves a literal, a trigger ref, and an earlier-step ref', () => {
    const mappings: FieldMapping[] = [
      { path: 'channel', target: 'body', required: true, source: { kind: 'literal', value: 'C0123ABC' } },
      { path: 'text', target: 'body', required: true, source: { kind: 'ref', expression: '$trigger.payload.call_id' } },
      { path: 'thread_ts', target: 'body', required: false, source: { kind: 'ref', expression: '$steps.step_1.response.ts' } },
    ];
    const step = { ...baseStep, mappings };
    const { resolved, blockingIssues, warnings } = resolveStepMappings(step, ctxWith());

    expect(blockingIssues).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(resolved).toEqual([
      { mapping: mappings[0], value: 'C0123ABC' },
      { mapping: mappings[1], value: 'call_123' },
      { mapping: mappings[2], value: '1716239022.123456' },
    ]);
  });

  it('marks an explicit unresolved required field as blocking (step must be skipped)', () => {
    const mappings: FieldMapping[] = [
      { path: 'channel', target: 'body', required: true, source: { kind: 'unresolved', reason: 'LLM could not determine a channel' } },
      { path: 'text', target: 'body', required: true, source: { kind: 'literal', value: 'hello' } },
    ];
    const step = { ...baseStep, mappings };
    const { resolved, blockingIssues } = resolveStepMappings(step, ctxWith());

    expect(blockingIssues).toHaveLength(1);
    expect(blockingIssues[0].code).toBe('unresolved_required_field');
    expect(blockingIssues[0].severity).toBe('error');
    expect(resolved).toHaveLength(1);
  });

  it('marks an unresolved OPTIONAL field as a warning only (not blocking)', () => {
    const mappings: FieldMapping[] = [
      { path: 'channel', target: 'body', required: true, source: { kind: 'literal', value: 'C0123ABC' } },
      { path: 'text', target: 'body', required: true, source: { kind: 'literal', value: 'hi' } },
      { path: 'thread_ts', target: 'body', required: false, source: { kind: 'ref', expression: '$steps.step_1.response.missing_field' } },
    ];
    const step = { ...baseStep, mappings };
    const { blockingIssues, warnings } = resolveStepMappings(step, ctxWith());

    expect(blockingIssues).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('invalid_ref');
  });

  it('rejects a forward reference on a required field as blocking, coded forward_reference', () => {
    const mappings: FieldMapping[] = [
      { path: 'channel', target: 'body', required: true, source: { kind: 'ref', expression: '$steps.step_2.response.channel' } },
    ];
    const step = { ...baseStep, id: 'step_1', mappings };
    const ctx = ctxWith({ currentStepId: 'step_1', earlierStepIds: new Set() });
    const { blockingIssues } = resolveStepMappings(step, ctx);

    expect(blockingIssues).toHaveLength(1);
    expect(blockingIssues[0].code).toBe('forward_reference');
  });

  it('rejects a self-reference as a forward reference', () => {
    const mappings: FieldMapping[] = [
      { path: 'channel', target: 'body', required: true, source: { kind: 'ref', expression: '$steps.step_2.response.channel' } },
    ];
    const step = { ...baseStep, mappings };
    const ctx = ctxWith({ earlierStepIds: new Set(['step_1', 'step_2']) });
    const { blockingIssues } = resolveStepMappings(step, ctx);

    expect(blockingIssues).toHaveLength(1);
    expect(blockingIssues[0].code).toBe('forward_reference');
  });

  it('resolves a secret source to a masked placeholder, never the real value', () => {
    const mappings: FieldMapping[] = [
      { path: 'api_key', target: 'query', required: true, source: { kind: 'secret', envVar: 'SLACK_BOT_TOKEN' } },
    ];
    const step = { ...baseStep, mappings };
    const { resolved } = resolveStepMappings(step, ctxWith());
    expect(resolved[0].value).toBe('<SLACK_BOT_TOKEN>');
  });
});

describe('mapping/validate', () => {
  const schema = {
    type: 'object' as const,
    required: ['channel', 'text'],
    properties: {
      channel: { type: 'string' as const },
      text: { type: 'string' as const },
    },
  };

  it('returns no issues for a valid body', () => {
    const issues = validateRequestBody(schema, { channel: 'C1', text: 'hi' });
    expect(issues).toHaveLength(0);
  });

  it('returns schema_violation issues for a missing required field', () => {
    const issues = validateRequestBody(schema, { channel: 'C1' });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].code).toBe('schema_violation');
  });

  it('is a no-op when requestSchema is null', () => {
    expect(validateRequestBody(null, { anything: true })).toHaveLength(0);
  });
});
