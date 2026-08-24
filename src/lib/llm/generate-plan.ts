import { randomUUID } from 'node:crypto';
import { generateObject } from 'ai';
import { z } from 'zod';
import { PlanOutputSchema } from '@/schemas/workflow.zod';
import { byId } from '@/knowledge';
import type { EndpointSpec, JsonSchema, JsonValue, ServiceId } from '@/types/endpoint';
import type { FieldMapping, PlanIssue, TriggerSpec, WorkflowPlan, WorkflowStep } from '@/types/workflow';
import type { RetrievedEndpoint } from '@/types/endpoint';
import { MODEL_ID } from './model';
import { buildSystemPrompt } from './system-prompt';

type PlanOutput = z.infer<typeof PlanOutputSchema>;

const SERVICE_IDS: ServiceId[] = [
  'elevenlabs', 'stripe', 'gmail', 'slack', 'twilio', 'notion', 'openai', 'airtable',
];

function isServiceId(value: string): value is ServiceId {
  return (SERVICE_IDS as string[]).includes(value);
}

/** Thrown when the model fails to produce a valid, non-empty plan after one repair attempt. */
export class PlanGenerationError extends Error {}

export interface GeneratePlanResult {
  plan: WorkflowPlan;
  issues: PlanIssue[];
}

/**
 * generateObject + repair loop -> validated, server-repaired WorkflowPlan
 * (DESIGN.md section 5).
 */
export async function generatePlan(
  prompt: string,
  candidates: RetrievedEndpoint[]
): Promise<GeneratePlanResult> {
  const system = buildSystemPrompt(candidates);

  let raw: PlanOutput;
  try {
    raw = await callModel(system, prompt);
  } catch (firstError) {
    const errorText = firstError instanceof Error ? firstError.message : String(firstError);
    try {
      raw = await callModel(
        system,
        `${prompt}\n\n---\nYour previous response was invalid and failed schema validation with this error:\n${errorText}\nReturn a corrected response that matches the output contract exactly.`
      );
    } catch (secondError) {
      const secondMessage = secondError instanceof Error ? secondError.message : String(secondError);
      throw new PlanGenerationError(
        `LLM failed to produce a valid plan after one repair attempt: ${secondMessage}`
      );
    }
  }

  return postProcess(prompt, raw);
}

async function callModel(system: string, userPrompt: string): Promise<PlanOutput> {
  const { object } = await generateObject({
    model: MODEL_ID,
    system,
    prompt: userPrompt,
    schema: PlanOutputSchema,
  });
  return object;
}

/** Required (path, target) pairs for an endpoint: required params + top-level required body fields. */
function getRequiredFieldEntries(endpoint: EndpointSpec): Array<{ path: string; target: FieldMapping['target'] }> {
  const paramEntries = endpoint.params
    .filter((p) => p.required)
    .map((p) => ({ path: p.name, target: p.location as FieldMapping['target'] }));

  const bodyEntries = (endpoint.requestSchema?.required ?? []).map((name) => ({
    path: name,
    target: 'body' as FieldMapping['target'],
  }));

  return [...paramEntries, ...bodyEntries];
}

function postProcess(prompt: string, raw: PlanOutput): GeneratePlanResult {
  const issues: PlanIssue[] = [];
  const steps: WorkflowStep[] = [];
  const validStepIds = new Set<string>();
  let order = 0;

  for (const rawStep of raw.steps) {
    const endpoint = byId.get(rawStep.endpointId);
    if (!endpoint) {
      issues.push({
        severity: 'error',
        stepId: rawStep.id,
        code: 'unknown_endpoint',
        message: `Step "${rawStep.id}" references unknown endpointId "${rawStep.endpointId}"; step dropped.`,
      });
      continue;
    }

    const requiredEntries = getRequiredFieldEntries(endpoint);
    const seenRequired = new Set<string>();
    const mappings: FieldMapping[] = [];

    for (const rawMapping of rawStep.mappings) {
      let source: FieldMapping['source'] = rawMapping.source as FieldMapping['source'];

      if (source.kind === 'ref') {
        const stepRefMatch = /^\$steps\.([^.]+)\./.exec(source.expression);
        if (stepRefMatch) {
          const refStepId = stepRefMatch[1];
          if (!validStepIds.has(refStepId)) {
            issues.push({
              severity: 'error',
              stepId: rawStep.id,
              path: rawMapping.path,
              code: 'forward_reference',
              message: `Mapping "${rawMapping.path}" on step "${rawStep.id}" references "${source.expression}", which is not an earlier step in this plan; marked unresolved.`,
            });
            source = { kind: 'unresolved', reason: `Forward or unknown step reference: ${source.expression}` };
          }
        } else if (!source.expression.startsWith('$trigger.')) {
          issues.push({
            severity: 'error',
            stepId: rawStep.id,
            path: rawMapping.path,
            code: 'invalid_ref',
            message: `Mapping "${rawMapping.path}" on step "${rawStep.id}" has an invalid reference expression "${source.expression}"; marked unresolved.`,
          });
          source = { kind: 'unresolved', reason: `Invalid reference expression: ${source.expression}` };
        }
      }

      const requiredKey = `${rawMapping.target}:${rawMapping.path}`;
      const isRequired = requiredEntries.some((r) => `${r.target}:${r.path}` === requiredKey);
      if (isRequired) seenRequired.add(requiredKey);

      mappings.push({
        path: rawMapping.path,
        target: rawMapping.target,
        source,
        required: isRequired,
        note: rawMapping.note,
      });
    }

    for (const required of requiredEntries) {
      const key = `${required.target}:${required.path}`;
      if (seenRequired.has(key)) continue;
      mappings.push({
        path: required.path,
        target: required.target,
        source: { kind: 'unresolved', reason: `Required field "${required.path}" was not provided by the model.` },
        required: true,
      });
      issues.push({
        severity: 'error',
        stepId: rawStep.id,
        path: required.path,
        code: 'unresolved_required_field',
        message: `Step "${rawStep.id}" is missing required field "${required.path}"; marked unresolved.`,
      });
    }

    steps.push({
      id: rawStep.id,
      order: order++,
      endpointId: rawStep.endpointId,
      title: rawStep.title,
      rationale: rawStep.rationale,
      mappings,
    });
    validStepIds.add(rawStep.id);
  }

  if (steps.length === 0) {
    throw new PlanGenerationError('No step in the model output referenced a known endpointId; zero steps survived.');
  }

  const trigger: TriggerSpec = {
    service: isServiceId(raw.trigger.service) ? raw.trigger.service : 'manual',
    eventName: raw.trigger.eventName,
    description: raw.trigger.description,
    payloadSchema: inferJsonSchema(raw.trigger.samplePayload as unknown as JsonValue),
    samplePayload: raw.trigger.samplePayload as unknown as JsonValue,
  };

  const plan: WorkflowPlan = {
    version: 1,
    id: `plan_${randomUUID()}`,
    name: raw.name,
    description: raw.description,
    prompt,
    trigger,
    steps,
    issues,
    createdAt: new Date().toISOString(),
  };

  return { plan, issues };
}

/** Minimal JSON Schema inference from a sample payload value; the LLM output contract has no payloadSchema field. */
function inferJsonSchema(value: JsonValue): JsonSchema {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    return { type: 'array', items: value.length > 0 ? inferJsonSchema(value[0]) : {} };
  }
  if (typeof value === 'object') {
    const properties: Record<string, JsonSchema> = {};
    for (const [key, v] of Object.entries(value)) {
      properties[key] = inferJsonSchema(v);
    }
    return { type: 'object', properties, required: Object.keys(value) };
  }
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  return { type: 'string' };
}
