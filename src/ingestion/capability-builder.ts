import type { ApiVersion } from '@/knowledge/api-version';
import { CapabilitySchema, type Capability } from '@/knowledge/capability';
import { ImplementationSchema, type Implementation } from '@/knowledge/implementation';
import type { NormalizedCapability } from './normalizer';
import type { DraftValidation, IngestionIssue } from './types';

/**
 * Stage 6 — capability building. Stamps the validator's verdict onto the
 * normalized record and runs it through the canonical Zod schemas one last
 * time, so nothing enters the store that the store's own loader would reject.
 */
export interface BuiltCapability {
  capability: Capability;
  implementation: Implementation;
}

export function buildCapability(
  normalized: NormalizedCapability,
  validation: DraftValidation,
  apiVersion: ApiVersion
): { built: BuiltCapability | null; issues: IngestionIssue[] } {
  const issues = [...validation.issues];

  if (!validation.ok) {
    return { built: null, issues };
  }

  const capability: Capability = {
    ...normalized.capability,
    confidence: validation.confidence,
    last_verified: apiVersion.last_verified,
  };

  const capabilityCheck = CapabilitySchema.safeParse(capability);
  if (!capabilityCheck.success) {
    issues.push({
      severity: 'error',
      provider_id: capability.provider_id,
      capability_id: capability.id,
      code: 'canonical_schema_rejected',
      message: `${capability.id} does not satisfy the canonical Capability schema: ${summarize(capabilityCheck.error.issues)}`,
    });
    return { built: null, issues };
  }

  const implementationCheck = ImplementationSchema.safeParse(normalized.implementation);
  if (!implementationCheck.success) {
    issues.push({
      severity: 'error',
      provider_id: capability.provider_id,
      capability_id: capability.id,
      code: 'canonical_schema_rejected',
      message: `${normalized.implementation.id} does not satisfy the canonical Implementation schema: ${summarize(implementationCheck.error.issues)}`,
    });
    return { built: null, issues };
  }

  return { built: { capability, implementation: normalized.implementation }, issues };
}

function summarize(issues: Array<{ path: (string | number)[]; message: string }>): string {
  return issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}
