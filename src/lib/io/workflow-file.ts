import type { WorkflowPlan } from '@/types';
import { WorkflowPlanSchema } from '@/schemas/workflow.zod';

export type ParseResult =
  | { ok: true; plan: WorkflowPlan }
  | { ok: false; error: string };

/**
 * Pretty-print a plan for export. Pure, no DOM/network — safe to unit test.
 */
export function serializePlan(plan: WorkflowPlan): string {
  return JSON.stringify(plan, null, 2);
}

/**
 * Parse + Zod-validate a workflow plan JSON string. Never throws; malformed
 * JSON or a schema violation both surface as a structured error.
 */
export function parseWorkflowFile(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }

  const result = WorkflowPlanSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { ok: false, error: `Plan does not match the expected schema: ${issues}` };
  }

  return { ok: true, plan: result.data as WorkflowPlan };
}

/** Suggested filename for a plan export. */
export function exportFileName(plan: WorkflowPlan): string {
  const slug = plan.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `${slug || 'workflow'}.integrelli.json`;
}

/**
 * Trigger a browser download of the plan as a JSON file. Browser-only —
 * kept separate from the pure serialize/parse logic above so that logic can
 * run under vitest with no DOM.
 */
export function downloadPlan(plan: WorkflowPlan): void {
  const blob = new Blob([serializePlan(plan)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = exportFileName(plan);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Read an uploaded File and parse it into a WorkflowPlan. Browser-only.
 */
export function readWorkflowFile(file: File): Promise<ParseResult> {
  return file.text().then(parseWorkflowFile);
}
