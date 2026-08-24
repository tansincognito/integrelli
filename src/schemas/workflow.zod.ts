import { z } from 'zod';

/**
 * Zod mirrors of src/types/workflow.ts.
 *
 * Two families are exported:
 *  - the "full" plan schema, used to validate import/export and the body of
 *    /api/execute (client can edit mappings, so the server never trusts it).
 *    This includes the `unresolved` mapping-source kind.
 *  - the "LLM output" schema (`PlanOutputSchema`), the structured-output
 *    contract passed to `generateObject`. Per DESIGN.md section 5, this
 *    variant OMITS `unresolved` from MappingSource, and omits `issues`,
 *    `createdAt`, and `order` — the server assigns those.
 */

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
);

const JsonSchemaSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z
      .enum(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
      .optional(),
    properties: z.record(z.string(), JsonSchemaSchema).optional(),
    required: z.array(z.string()).optional(),
    items: JsonSchemaSchema.optional(),
    enum: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    format: z.enum(['email', 'uri', 'date-time', 'uuid']).optional(),
    description: z.string().optional(),
    example: JsonValueSchema.optional(),
    additionalProperties: z.boolean().optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
  })
);

const ServiceIdSchema = z.enum([
  'elevenlabs',
  'stripe',
  'gmail',
  'slack',
  'twilio',
  'notion',
  'openai',
  'airtable',
]);

const PlanIssueSchema = z.object({
  severity: z.enum(['error', 'warning']),
  stepId: z.string().optional(),
  path: z.string().optional(),
  code: z.enum([
    'unknown_endpoint',
    'unresolved_required_field',
    'invalid_ref',
    'schema_violation',
    'llm_output_invalid',
    'forward_reference',
  ]),
  message: z.string(),
});

// --- Full plan schema (import/export, /api/execute request body) ---

const FullMappingSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('literal'), value: JsonValueSchema }),
  z.object({ kind: z.literal('secret'), envVar: z.string().regex(/^[A-Z0-9_]+$/) }),
  z.object({ kind: z.literal('ref'), expression: z.string().startsWith('$') }),
  z.object({ kind: z.literal('unresolved'), reason: z.string() }),
]);

const FullFieldMappingSchema = z.object({
  path: z.string().min(1),
  target: z.enum(['body', 'header', 'query', 'path']),
  source: FullMappingSourceSchema,
  required: z.boolean(),
  note: z.string().optional(),
});

const TriggerSpecSchema = z.object({
  service: z.union([ServiceIdSchema, z.literal('manual')]),
  eventName: z.string(),
  description: z.string(),
  payloadSchema: JsonSchemaSchema,
  samplePayload: JsonValueSchema,
});

const WorkflowStepSchema = z.object({
  id: z.string().regex(/^step_\d+$/),
  order: z.number().int().nonnegative(),
  endpointId: z.string(),
  title: z.string(),
  rationale: z.string(),
  mappings: z.array(FullFieldMappingSchema),
});

export const WorkflowPlanSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  name: z.string(),
  description: z.string(),
  prompt: z.string(),
  trigger: TriggerSpecSchema,
  steps: z.array(WorkflowStepSchema),
  issues: z.array(PlanIssueSchema),
  createdAt: z.string(),
});

// --- LLM-facing structured output (section 5, verbatim) ---

const MappingSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('literal'), value: z.unknown() }),
  z.object({ kind: z.literal('secret'), envVar: z.string().regex(/^[A-Z0-9_]+$/) }),
  z.object({ kind: z.literal('ref'), expression: z.string().startsWith('$') }),
]);

const FieldMappingSchema = z.object({
  path: z.string().min(1),
  target: z.enum(['body', 'header', 'query', 'path']),
  source: MappingSourceSchema,
  note: z.string().optional(),
});

const StepSchema = z.object({
  id: z.string().regex(/^step_\d+$/),
  endpointId: z.string(),
  title: z.string(),
  rationale: z.string(),
  mappings: z.array(FieldMappingSchema),
});

export const PlanOutputSchema = z.object({
  name: z.string(),
  description: z.string(),
  trigger: z.object({
    service: z.string(),
    eventName: z.string(),
    description: z.string(),
    samplePayload: z.record(z.string(), z.unknown()),
  }),
  steps: z.array(StepSchema).min(1).max(6),
});
