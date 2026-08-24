import type { JsonValue, JsonSchema, ServiceId } from './endpoint';

/**
 * Reference expression. Restricted grammar (NOT full JSONPath):
 *   $trigger.payload.<dotted.path>
 *   $steps.<stepId>.response.<dotted.path>
 * Array indexing with [n] is allowed inside the dotted path.
 */
export type RefExpression = string;

export type MappingSource =
  | { kind: 'literal'; value: JsonValue }
  | { kind: 'secret'; envVar: string }
  | { kind: 'ref'; expression: RefExpression }
  | { kind: 'unresolved'; reason: string };

export type MappingTarget = 'body' | 'header' | 'query' | 'path';

/** One bound input on a step. Flat list is the single source of truth for the request. */
export interface FieldMapping {
  /** Dotted path within the target, e.g. "line_items[0].price" or "Content-Type". */
  path: string;
  target: MappingTarget;
  source: MappingSource;
  /** True if the endpoint schema marks this field required. Drives the error banner. */
  required: boolean;
  note?: string;
}

export interface TriggerSpec {
  service: ServiceId | 'manual';
  /** e.g. "elevenlabs.call.completed" */
  eventName: string;
  description: string;
  /** Shape of the described event payload; steps may $trigger.payload.* into it. */
  payloadSchema: JsonSchema;
  samplePayload: JsonValue;
}

export interface WorkflowStep {
  /** Stable, referenced by $steps.<id>. Format: "step_1", "step_2", ... */
  id: string;
  order: number;
  endpointId: string;
  title: string;
  rationale: string;
  mappings: FieldMapping[];
}

export interface PlanIssue {
  severity: 'error' | 'warning';
  stepId?: string;
  path?: string;
  code:
    | 'unknown_endpoint'
    | 'unresolved_required_field'
    | 'invalid_ref'
    | 'schema_violation'
    | 'llm_output_invalid'
    | 'forward_reference';
  message: string;
}

export interface WorkflowPlan {
  version: 1;
  id: string;
  name: string;
  description: string;
  prompt: string;
  trigger: TriggerSpec;
  steps: WorkflowStep[];
  /** Non-fatal problems detected at plan time; rendered in the inspector. */
  issues: PlanIssue[];
  createdAt: string;
}
