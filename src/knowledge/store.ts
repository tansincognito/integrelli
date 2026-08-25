import { z } from 'zod';
import { ApiVersionSchema, type ApiVersion } from './api-version';
import { CapabilitySchema, type Capability } from './capability';
import { ImplementationSchema, type Implementation } from './implementation';
import { ProviderSchema, type Provider } from './provider';
import rawStore from '@/generated/capability-store.json';

/**
 * The persisted capability graph. Written by `npm run ingest`
 * (scripts/ingest.ts), read by retrieval and the planner.
 *
 * It is a committed JSON file rather than a database on purpose — see
 * architecture.md, Decision "Storage engine for the capability graph".
 */
export interface KnowledgeStore {
  version: 1;
  built_at: string;
  providers: Provider[];
  api_versions: ApiVersion[];
  capabilities: Capability[];
  implementations: Implementation[];
  /** Non-fatal problems recorded during the ingestion run that produced this store. */
  ingestion_issues: StoredIngestionIssue[];
}

export interface StoredIngestionIssue {
  severity: 'error' | 'warning';
  provider_id: string;
  capability_id?: string;
  code: string;
  message: string;
}

export const KnowledgeStoreSchema = z.object({
  version: z.literal(1),
  built_at: z.string(),
  providers: z.array(ProviderSchema),
  api_versions: z.array(ApiVersionSchema),
  capabilities: z.array(CapabilitySchema),
  implementations: z.array(ImplementationSchema),
  ingestion_issues: z.array(
    z.object({
      severity: z.enum(['error', 'warning']),
      provider_id: z.string(),
      capability_id: z.string().optional(),
      code: z.string(),
      message: z.string(),
    })
  ),
});

export interface LoadedStore {
  store: KnowledgeStore;
  capabilitiesById: Map<string, Capability>;
  implementationsByCapability: Map<string, Implementation[]>;
  providersById: Map<string, Provider>;
  apiVersionsById: Map<string, ApiVersion>;
}

let cached: LoadedStore | null = null;

/**
 * Loads and indexes the committed store. Validates once per process; a store
 * that fails validation is a build error, not something to degrade around —
 * every downstream layer assumes these records are well-formed.
 */
export function loadStore(override?: unknown): LoadedStore {
  if (!override && cached) return cached;

  const parsed = KnowledgeStoreSchema.safeParse(override ?? rawStore);
  if (!parsed.success) {
    throw new Error(
      `capability-store.json failed canonical-model validation: ${JSON.stringify(parsed.error.issues.slice(0, 5))}`
    );
  }
  const store = parsed.data as KnowledgeStore;

  const implementationsByCapability = new Map<string, Implementation[]>();
  for (const implementation of store.implementations) {
    const list = implementationsByCapability.get(implementation.capability_id) ?? [];
    list.push(implementation);
    implementationsByCapability.set(implementation.capability_id, list);
  }

  const loaded: LoadedStore = {
    store,
    capabilitiesById: new Map(store.capabilities.map((c) => [c.id, c])),
    implementationsByCapability,
    providersById: new Map(store.providers.map((p) => [p.id, p])),
    apiVersionsById: new Map(store.api_versions.map((v) => [v.id, v])),
  };

  if (!override) cached = loaded;
  return loaded;
}

/** Test-only: drops the module-scope cache so a test can load an alternate store. */
export function _resetStoreCacheForTests(): void {
  cached = null;
}

export function allCapabilities(): Capability[] {
  return loadStore().store.capabilities;
}

export function getCapability(id: string): Capability | undefined {
  return loadStore().capabilitiesById.get(id);
}

export function getImplementations(capabilityId: string): Implementation[] {
  return loadStore().implementationsByCapability.get(capabilityId) ?? [];
}
