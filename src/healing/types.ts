import type { JsonValue } from '@/types/endpoint';

/**
 * Self-healing subsystem (architecture.md's flagship gap — see the Day 1/2
 * reviews' "Day 2 recommendations" and the project brief's 5 failure
 * classes). Everything here is deterministic: classification and patching
 * are rule-based, not model calls, so the eval numbers in
 * tests/fixtures/drift-scenarios.ts are reproducible.
 */

export type FailureClass =
  | 'renamed_field'
  | 'new_enum_value'
  | 'type_change'
  | 'expired_token'
  | 'removed_endpoint';

/**
 * A drift to inject at one plan step's HTTP call. `field` is a dotted path
 * matching one of that step's capability's `outputs[].path` entries — the
 * same path grammar `getByPath`/`setByPath` already use.
 */
export interface DriftScenario {
  id: string;
  class: FailureClass;
  stepId: string;
  /** renamed_field / type_change / new_enum_value target field. */
  field?: string;
  /** renamed_field: the upstream API's new name for the last path segment. */
  renameTo?: string;
  /** type_change: the JS type the field now comes back as. */
  forceType?: 'string' | 'number' | 'boolean';
  /** new_enum_value: a value outside the capability's declared enum for `field`. */
  enumValue?: JsonValue;
  description: string;
}

export interface Classification {
  class: FailureClass;
  /** The step whose call/mapping the finding is attached to. */
  stepId: string;
  /** For field-level classes: which upstream step produced the drifted value. */
  sourceStepId?: string;
  /** For field-level classes: the capability output path involved. */
  path?: string;
  /** renamed_field only: the same-typed sibling key found in the actual response, if any. */
  candidatePath?: string;
  /** type_change/new_enum_value: the value actually observed. */
  actualValue?: JsonValue;
  confidence: number;
  evidence: string;
}

export type PatchAction =
  | { kind: 'remap_field'; stepId: string; fromPath: string; toPath: string }
  | { kind: 'accept_enum_value'; stepId: string; sourceStepId: string; path: string; value: string | number | boolean }
  | { kind: 'coerce_type'; stepId: string; sourceStepId: string; path: string; toType: 'string' | 'number' | 'boolean' }
  | { kind: 'refresh_token'; stepId: string }
  | { kind: 'escalate'; stepId: string; reason: string };

export interface Patch {
  classification: Classification;
  action: PatchAction;
}

export type RepairOutcome = 'no_failure' | 'auto_repaired' | 'escalated' | 'wrong_patch';

export interface RepairAttempt {
  classification: Classification;
  patch: Patch;
  outcome: RepairOutcome;
}
