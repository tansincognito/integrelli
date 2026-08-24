import { z } from 'zod';
import { WorkflowPlanSchema } from './workflow.zod';

/** Zod schema for the POST /api/execute request body (DESIGN.md section 7). */

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

const FaultInjectionSchema = z.object({
  stepId: z.string(),
  status: z.union([z.literal(429), z.literal(500), z.literal(502), z.literal(503)]),
  applyToAttempts: z.union([z.number().int().positive(), z.literal('all')]),
  body: JsonValueSchema.optional(),
});

export const ExecuteRequestSchema = z.object({
  plan: WorkflowPlanSchema,
  seed: z.string().min(1),
  mode: z.enum(['test', 'live']),
  faults: z.array(FaultInjectionSchema),
});

export type ExecuteRequest = z.infer<typeof ExecuteRequestSchema>;
