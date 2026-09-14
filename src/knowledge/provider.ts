import { z } from 'zod';

/**
 * A third-party API vendor. One provider owns many API versions; capabilities
 * always hang off a (provider, api_version) pair so that "Stripe can create a
 * checkout session" is never stated without saying *which* Stripe.
 */
export interface Provider {
  id: string;
  name: string;
  /** Where the knowledge for this provider came from, at the provider level. */
  documentation_source: DocumentationSource;
  /** ApiVersion ids, newest first. */
  versions: string[];
}

export type DocumentSourceKind = 'openapi' | 'markdown' | 'html';

/**
 * A single ingestible document. `location` is a local path today; the fetcher
 * also accepts http(s) URLs so the same source record works against upstream
 * specs without a model change (see architecture.md section 5).
 */
export interface DocumentationSource {
  id: string;
  kind: DocumentSourceKind;
  /** Local path relative to repo root, or an http(s) URL. */
  location: string;
  /** Canonical upstream URL, recorded for provenance even when we read a local mirror. */
  upstream_url?: string;
  /** Human label used in provenance strings and validation messages. */
  label: string;
}

export const DocumentationSourceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['openapi', 'markdown', 'html']),
  location: z.string().min(1),
  upstream_url: z.string().url().optional(),
  label: z.string().min(1),
});

export const ProviderSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  documentation_source: DocumentationSourceSchema,
  versions: z.array(z.string()),
});
