import { z } from 'zod';
import { DocumentationSourceSchema, type DocumentationSource } from './provider';

export type ApiVersionStatus = 'stable' | 'beta' | 'deprecated';

/**
 * One version of one provider's API, pinned to the exact document it was
 * derived from. `content_hash` is the cache key for the whole ingestion
 * pipeline: unchanged hash means no re-parse, no LLM extraction, no re-embed.
 */
export interface ApiVersion {
  id: string;
  provider_id: string;
  version: string;
  status: ApiVersionStatus;
  source: DocumentationSource;
  /** SHA-256 of the raw fetched document bytes. */
  content_hash: string;
  /** ISO-8601 timestamp of the last successful ingestion run for this version. */
  last_verified: string;
}

export const ApiVersionSchema = z.object({
  id: z.string().min(1),
  provider_id: z.string().min(1),
  version: z.string().min(1),
  status: z.enum(['stable', 'beta', 'deprecated']),
  source: DocumentationSourceSchema,
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  last_verified: z.string().min(1),
});

export function apiVersionId(providerId: string, version: string): string {
  return `${providerId}@${version}`;
}
