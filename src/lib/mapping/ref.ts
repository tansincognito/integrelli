/**
 * Parse and validate the restricted reference grammar used by
 * `MappingSource.ref.expression` (see src/types/workflow.ts):
 *
 *   $trigger.payload.<dotted.path>
 *   $steps.<stepId>.response.<dotted.path>
 *
 * Array indexing with [n] is allowed inside the dotted path and is left
 * untouched here — `lib/utils/json-path.ts` parses that part.
 *
 * Pure, no network, no React.
 */

export interface TriggerRef {
  kind: 'trigger';
  /** Dotted path (with optional [n] indices) into the trigger payload. */
  path: string;
}

export interface StepRef {
  kind: 'step';
  stepId: string;
  /** Dotted path (with optional [n] indices) into the referenced step's response body. */
  path: string;
}

export type ParsedRef = TriggerRef | StepRef;

export type RefParseResult =
  | { ok: true; ref: ParsedRef }
  | { ok: false; error: string };

const TRIGGER_RE = /^\$trigger\.payload\.(.+)$/;
const STEP_RE = /^\$steps\.([A-Za-z0-9_]+)\.response\.(.+)$/;

/** Parse a reference expression. Does not know about plan/step context. */
export function parseRef(expression: string): RefParseResult {
  if (typeof expression !== 'string' || expression.length === 0) {
    return { ok: false, error: 'Reference expression must be a non-empty string.' };
  }
  if (!expression.startsWith('$')) {
    return { ok: false, error: `Reference must start with "$": "${expression}"` };
  }

  const triggerMatch = TRIGGER_RE.exec(expression);
  if (triggerMatch) {
    return { ok: true, ref: { kind: 'trigger', path: triggerMatch[1] } };
  }

  const stepMatch = STEP_RE.exec(expression);
  if (stepMatch) {
    return { ok: true, ref: { kind: 'step', stepId: stepMatch[1], path: stepMatch[2] } };
  }

  return {
    ok: false,
    error: `Unrecognized reference expression: "${expression}". Expected "$trigger.payload.*" or "$steps.<id>.response.*".`,
  };
}

/**
 * True if `ref` points at the current step itself, or at a step that has not
 * (yet) been established as earlier in the linear plan. `earlierStepIds`
 * must contain only step ids that are guaranteed to run before the current
 * step.
 */
export function isForwardReference(
  ref: StepRef,
  currentStepId: string,
  earlierStepIds: ReadonlySet<string>
): boolean {
  if (ref.stepId === currentStepId) return true;
  return !earlierStepIds.has(ref.stepId);
}
