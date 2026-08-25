import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { JsonSchemaNode } from '@/knowledge/schema';
import type { NormalizedCapability } from './normalizer';
import type { CapabilityDraft, DraftValidation, IngestionIssue, ValidationCheck } from './types';

/**
 * Stage 5 — validation. Runs the same eight checks against every capability
 * regardless of which path produced it, plus a ninth cross-check when an
 * OpenAPI document is available to contradict a documentation-derived claim.
 *
 * The output is a confidence score. Confidence answers "how much do we trust
 * this record", which is a different question from "how well does this record
 * match the query" — see architecture.md section 7.
 */

const ajv = new Ajv({ strict: false, allErrors: true, validateSchema: false });
addFormats(ajv);

/** Starting confidence by extractor. A machine-readable spec beats prose, always. */
const BASE_CONFIDENCE: Record<CapabilityDraft['extractor'], number> = {
  openapi: 0.95,
  llm: 0.65,
  'markdown-heuristic': 0.55,
};

const CROSS_CHECK_BONUS = 0.25;
const FAILED_CHECK_PENALTY = 0.1;
const NO_RESPONSE_SCHEMA_PENALTY = 0.05;

export interface ValidationContext {
  /** `METHOD path` keys from the provider's OpenAPI document, when one was ingested. */
  openApiIndex?: Set<string>;
}

export function validateDraft(
  draft: CapabilityDraft,
  normalized: NormalizedCapability,
  context: ValidationContext = {}
): DraftValidation {
  const checks: ValidationCheck[] = [];
  const issues: IngestionIssue[] = [];
  const { capability, implementation } = normalized;

  const push = (
    name: ValidationCheck['name'],
    passed: boolean,
    applicable = true,
    detail?: string
  ): void => {
    checks.push({ name, passed, applicable, detail });
  };

  push('endpoint_exists', implementation.endpoint.trim().length > 0);
  push('http_method_exists', implementation.method !== null);

  const declaredPathParameters = implementation.path_parameters;
  const missingPathParameters = declaredPathParameters.filter(
    (name) => !capability.inputs.some((input) => input.location === 'path' && input.name === name && input.required)
  );
  push(
    'required_parameters_identified',
    missingPathParameters.length === 0,
    true,
    missingPathParameters.length > 0 ? `Path placeholders without a required input: ${missingPathParameters.join(', ')}` : undefined
  );

  const requestSchemaResult = compilesAsSchema(implementation.request_schema);
  push('request_schema_valid', requestSchemaResult.ok, implementation.request_schema !== null, requestSchemaResult.error);

  const responseSchemaResult = compilesAsSchema(implementation.response_schema);
  push('response_schema_valid', responseSchemaResult.ok, implementation.response_schema !== null, responseSchemaResult.error);

  const authIdentified =
    capability.kind === 'event'
      ? true
      : capability.authentication.kind !== 'none' && Boolean(capability.authentication.env_var_name);
  push('authentication_identified', authIdentified);

  push('api_version_identified', draft.api_version.trim().length > 0);
  push(
    'source_location_recorded',
    capability.source.pointer.trim().length > 0 && capability.source.document_source_id.trim().length > 0
  );

  const crossCheckApplicable = Boolean(context.openApiIndex) && draft.extractor !== 'openapi' && implementation.method !== null;
  let crossCheckPassed = false;
  if (crossCheckApplicable && context.openApiIndex) {
    const path = stripOrigin(implementation.endpoint);
    crossCheckPassed = context.openApiIndex.has(`${implementation.method} ${path}`);
    push(
      'openapi_cross_check',
      crossCheckPassed,
      true,
      crossCheckPassed ? undefined : `${implementation.method} ${path} is not present in the provider's OpenAPI document.`
    );
  } else {
    push('openapi_cross_check', false, false, 'No OpenAPI document available for this provider.');
  }

  let confidence = BASE_CONFIDENCE[draft.extractor];
  for (const check of checks) {
    if (check.applicable && !check.passed && check.name !== 'openapi_cross_check') {
      confidence -= FAILED_CHECK_PENALTY;
    }
  }
  if (crossCheckPassed) confidence += CROSS_CHECK_BONUS;
  if (crossCheckApplicable && !crossCheckPassed) confidence -= FAILED_CHECK_PENALTY;
  if (!implementation.response_schema) confidence -= NO_RESPONSE_SCHEMA_PENALTY;
  confidence = Math.max(0.05, Math.min(0.99, Number(confidence.toFixed(3))));

  /**
   * Hard checks gate admission to the knowledge base. A capability that fails
   * one is dropped, not stored at low confidence — a record we cannot address
   * or call is not partially useful, it is noise the planner would trip over.
   */
  const HARD_CHECKS: ValidationCheck['name'][] = [
    'endpoint_exists',
    'http_method_exists',
    'api_version_identified',
    'source_location_recorded',
    'request_schema_valid',
  ];

  const failedHard = checks.filter((c) => c.applicable && !c.passed && HARD_CHECKS.includes(c.name));
  for (const check of failedHard) {
    issues.push({
      severity: 'error',
      provider_id: capability.provider_id,
      capability_id: capability.id,
      code: `failed_${check.name}`,
      message: `${capability.id} rejected: ${check.name} failed${check.detail ? ` — ${check.detail}` : ''}.`,
    });
  }

  for (const check of checks) {
    if (check.applicable && !check.passed && !HARD_CHECKS.includes(check.name)) {
      issues.push({
        severity: 'warning',
        provider_id: capability.provider_id,
        capability_id: capability.id,
        code: `soft_${check.name}`,
        message: `${capability.id}: ${check.name} failed${check.detail ? ` — ${check.detail}` : ''}; confidence reduced.`,
      });
    }
  }

  return { ok: failedHard.length === 0, confidence, checks, issues };
}

function compilesAsSchema(schema: JsonSchemaNode | null): { ok: boolean; error?: string } {
  if (!schema) return { ok: true };
  try {
    ajv.compile(schema as object);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function stripOrigin(endpoint: string): string {
  return endpoint.replace(/^https?:\/\/[^/]+/, '');
}
