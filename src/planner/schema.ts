import { z } from 'zod';

/**
 * The workflow plan contract (architecture.md section 8).
 *
 * This is the only shape the planner is allowed to emit. It is also the shape
 * the validator consumes, so "the model returned something structurally
 * unusable" is caught by Zod at the tool boundary rather than by a downstream
 * crash.
 *
 * Reference grammar for mappings:
 *   step_2.properties.email          field of a step in this plan
 *   stripe.get_customer.email        field of the step running that capability
 *   literal:me                       a constant supplied by the plan
 */
export const EXECUTION_MODES = ['deterministic'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/**
 * Named value transformations the executor is expected to provide. The planner
 * may only reference these; it cannot describe a transformation in prose.
 * Day 1 ships the registry and validates against it — the implementations
 * belong to the execution engine, which is out of scope today.
 */
export const TRANSFORMS = [
  'identity',
  /** Assemble an RFC 2822 message and base64url encode it, as Gmail's `raw` field requires. */
  'rfc822_base64url',
  /** Major currency units to the smallest unit (12.50 → 1250). */
  'to_minor_units',
  'to_string',
  'json_stringify',
] as const;
export type TransformName = (typeof TRANSFORMS)[number];

export const PlanStepSchema = z.object({
  /** `step_1`, `step_2`, … in execution order. */
  id: z.string().regex(/^step_\d+$/),
  /** Capability id exactly as it appears in the candidate list. */
  capability: z.string().min(1),
  /** Why this step is in the workflow, in one sentence. */
  purpose: z.string().min(1),
});

export const PlanMappingSchema = z.object({
  source: z.string().min(1),
  destination: z.string().min(1),
  transform: z.enum(TRANSFORMS).optional(),
});

export const WorkflowPlanSchema = z.object({
  execution_mode: z.enum(EXECUTION_MODES),
  name: z.string().min(1),
  description: z.string().min(1),
  steps: z.array(PlanStepSchema).min(1).max(6),
  mappings: z.array(PlanMappingSchema),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;
export type PlanMapping = z.infer<typeof PlanMappingSchema>;
export type WorkflowPlan = z.infer<typeof WorkflowPlanSchema>;
