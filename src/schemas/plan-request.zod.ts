import { z } from 'zod';

/** Zod schema for the POST /api/plan request body (DESIGN.md section 7). */
export const PlanRequestSchema = z.object({
  prompt: z.string().min(3).max(2000),
});

export type PlanRequest = z.infer<typeof PlanRequestSchema>;
