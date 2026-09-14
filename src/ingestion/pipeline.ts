import { apiVersionId, type ApiVersion } from '@/knowledge/api-version';
import type { Capability } from '@/knowledge/capability';
import type { Implementation } from '@/knowledge/implementation';
import type { Provider } from '@/knowledge/provider';
import type { KnowledgeStore } from '@/knowledge/store';
import { modelFor, modelsAvailable } from '@/models';
import { buildCapability } from './capability-builder';
import { isFresh, loadCache, saveCache, type IngestionCacheFile } from './cache';
import { fetchDocument } from './fetcher';
import { emptyStore, readStoreFromDisk, writeStore } from './indexer';
import { normalizeDraft } from './normalizer';
import { chunkMarkdown, draftFromExtraction, extractHeuristic } from './parser/markdown';
import { extractWithLlm } from './parser/llm-extractor';
import { parseOpenApi } from './parser/openapi';
import { orderedSeeds, type ProviderSeed } from './sources';
import type { CapabilityDraft, IngestionIssue, ProviderIngestionResult } from './types';
import { validateDraft } from './validator';

/**
 * The ingestion pipeline:
 *
 *   DocumentSource → Fetcher → Parser → Normalizer → Validator → Builder → Indexer
 *
 * Provider-independent end to end: `ingestProvider(seed)` works for any seed in
 * the registry, and the only branch is which parser the source *kind* selects.
 *
 * Failure is per-provider and per-capability. One unreachable document or one
 * malformed operation degrades that slice of the graph and nothing else — see
 * architecture.md section 15.
 */

export interface IngestOptions {
  /** Re-parse and re-extract even when the content hash is unchanged. */
  force?: boolean;
  /** Skip the LLM extractor on the documentation path and use the deterministic one. */
  preferHeuristic?: boolean;
  /** Restrict the run to these provider ids. */
  only?: string[];
  cachePath?: string;
  storePath?: string;
}

export interface IngestRunResult {
  store: KnowledgeStore;
  results: ProviderIngestionResult[];
}

export async function ingestAll(options: IngestOptions = {}): Promise<IngestRunResult> {
  const cache = loadCache(options.cachePath);
  const previous = readStoreFromDisk(options.storePath) ?? emptyStore();

  const providers: Provider[] = [];
  const apiVersions: ApiVersion[] = [];
  const capabilities: Capability[] = [];
  const implementations: Implementation[] = [];
  const allIssues: IngestionIssue[] = [];
  const results: ProviderIngestionResult[] = [];

  const seeds = orderedSeeds().filter((seed) => !options.only || options.only.includes(seed.id));

  for (const seed of seeds) {
    const outcome = await ingestProvider(seed, { cache, previous, options });
    results.push(outcome.result);
    allIssues.push(...outcome.result.issues);
    if (outcome.provider) providers.push(outcome.provider);
    if (outcome.apiVersion) apiVersions.push(outcome.apiVersion);
    capabilities.push(...outcome.capabilities);
    implementations.push(...outcome.implementations);
  }

  const store: KnowledgeStore = {
    version: 1,
    built_at: new Date().toISOString(),
    providers,
    api_versions: apiVersions,
    capabilities,
    implementations,
    ingestion_issues: allIssues,
  };

  writeStore(store, options.storePath);
  saveCache(cache, options.cachePath);

  return { store, results };
}

interface ProviderContext {
  cache: IngestionCacheFile;
  previous: KnowledgeStore;
  options: IngestOptions;
}

interface ProviderOutcome {
  result: ProviderIngestionResult;
  provider?: Provider;
  apiVersion?: ApiVersion;
  capabilities: Capability[];
  implementations: Implementation[];
}

export async function ingestProvider(seed: ProviderSeed, context: ProviderContext): Promise<ProviderOutcome> {
  const issues: IngestionIssue[] = [];
  let llmCalls = 0;

  let document;
  try {
    document = await fetchDocument(seed.source);
  } catch (err) {
    return {
      result: {
        provider_id: seed.id,
        status: 'failed',
        content_hash: '',
        capability_count: 0,
        llm_calls: 0,
        issues: [
          {
            severity: 'error',
            provider_id: seed.id,
            code: 'fetch_failed',
            message: `Could not fetch ${seed.source.location}: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      },
      capabilities: [],
      implementations: [],
    };
  }

  const extractorSignature = extractorSignatureFor(seed, context.options);

  // Content-hash gate: unchanged document and unchanged extractor means the
  // previous run's records are still exactly what this run would produce.
  if (!context.options.force && isFresh(context.cache, seed.source.id, document.content_hash, extractorSignature)) {
    const carried = carryForward(seed, context.previous);
    if (carried) {
      return {
        result: {
          provider_id: seed.id,
          status: 'skipped',
          content_hash: document.content_hash,
          capability_count: carried.capabilities.length,
          llm_calls: 0,
          issues: [],
        },
        ...carried,
      };
    }
  }

  const apiVersion: ApiVersion = {
    id: apiVersionId(seed.id, seed.version),
    provider_id: seed.id,
    version: seed.version,
    status: seed.status,
    source: seed.source,
    content_hash: document.content_hash,
    last_verified: document.fetched_at,
  };

  const crossCheckIndex = await loadCrossCheckIndex(seed, issues);

  let drafts: CapabilityDraft[] = [];

  if (seed.source.kind === 'openapi') {
    const parsed = parseOpenApi(document.content, seed);
    drafts = parsed.drafts;
    issues.push(...parsed.issues);
    if (parsed.documentVersion && parsed.documentVersion !== seed.version) {
      issues.push({
        severity: 'warning',
        provider_id: seed.id,
        code: 'version_mismatch',
        message: `Document declares version "${parsed.documentVersion}" but the registry seeds "${seed.version}"; capabilities use the document's value.`,
      });
    }
  } else {
    const chunks = chunkMarkdown(document.content);
    if (chunks.length === 0) {
      issues.push({
        severity: 'warning',
        provider_id: seed.id,
        code: 'no_chunks',
        message: `${seed.source.location} produced no documentation sections containing an HTTP method line.`,
      });
    }

    for (const chunk of chunks) {
      const useLlm = modelsAvailable() && !context.options.preferHeuristic;
      const llmResult = useLlm ? await extractWithLlm(chunk, seed) : null;
      if (useLlm) llmCalls += 1;

      if (llmResult) {
        drafts.push(draftFromExtraction(llmResult.draft, seed, chunk.pointer, 'llm', llmResult.model));
        continue;
      }

      const heuristic = extractHeuristic(chunk);
      if (heuristic) {
        drafts.push(draftFromExtraction(heuristic, seed, chunk.pointer, 'markdown-heuristic'));
        continue;
      }

      issues.push({
        severity: 'warning',
        provider_id: seed.id,
        code: 'extraction_failed',
        message: `No extractor could turn section "${chunk.heading}" into a capability; section skipped.`,
      });
    }
  }

  const capabilities: Capability[] = [];
  const implementations: Implementation[] = [];
  const seenIds = new Set<string>();

  for (const draft of drafts) {
    const normalized = normalizeDraft(draft, seed);

    if (seenIds.has(normalized.capability.id)) {
      issues.push({
        severity: 'warning',
        provider_id: seed.id,
        capability_id: normalized.capability.id,
        code: 'duplicate_capability_id',
        message: `Two operations normalised to "${normalized.capability.id}" (${draft.source_pointer}); the later one was dropped.`,
      });
      continue;
    }

    const validation = validateDraft(draft, normalized, { openApiIndex: crossCheckIndex });
    const { built, issues: buildIssues } = buildCapability(normalized, validation, apiVersion);
    issues.push(...buildIssues);

    if (!built) continue;
    seenIds.add(built.capability.id);
    capabilities.push(built.capability);
    implementations.push(built.implementation);
  }

  context.cache.entries[seed.source.id] = {
    content_hash: document.content_hash,
    fetched_at: document.fetched_at,
    extractor_signature: extractorSignature,
    capability_ids: capabilities.map((c) => c.id),
  };

  const provider: Provider = {
    id: seed.id,
    name: seed.name,
    documentation_source: seed.source,
    versions: [apiVersion.id],
  };

  return {
    result: {
      provider_id: seed.id,
      status: capabilities.length > 0 ? 'ingested' : 'failed',
      content_hash: document.content_hash,
      capability_count: capabilities.length,
      llm_calls: llmCalls,
      issues,
    },
    provider,
    apiVersion,
    capabilities,
    implementations,
  };
}

/**
 * Extraction on the OpenAPI path is deterministic, so its signature is a
 * constant. On the documentation path the signature carries the model id, so
 * swapping the extraction model invalidates every capability it produced.
 */
function extractorSignatureFor(seed: ProviderSeed, options: IngestOptions): string {
  if (seed.source.kind === 'openapi') return 'openapi';
  if (modelsAvailable() && !options.preferHeuristic) return `llm:${modelFor('extraction')}`;
  return 'markdown-heuristic';
}

function carryForward(
  seed: ProviderSeed,
  previous: KnowledgeStore
): { provider?: Provider; apiVersion?: ApiVersion; capabilities: Capability[]; implementations: Implementation[] } | null {
  const provider = previous.providers.find((p) => p.id === seed.id);
  const apiVersion = previous.api_versions.find((v) => v.provider_id === seed.id);
  const capabilities = previous.capabilities.filter((c) => c.provider_id === seed.id);
  if (!provider || !apiVersion || capabilities.length === 0) return null;

  const capabilityIds = new Set(capabilities.map((c) => c.id));
  return {
    provider,
    apiVersion,
    capabilities,
    implementations: previous.implementations.filter((i) => capabilityIds.has(i.capability_id)),
  };
}

/** Loads the optional machine-readable document used to contradict prose extractions. */
async function loadCrossCheckIndex(seed: ProviderSeed, issues: IngestionIssue[]): Promise<Set<string> | undefined> {
  if (!seed.cross_check_source) return undefined;
  try {
    const document = await fetchDocument(seed.cross_check_source);
    return parseOpenApi(document.content, seed).operationIndex;
  } catch (err) {
    issues.push({
      severity: 'warning',
      provider_id: seed.id,
      code: 'cross_check_unavailable',
      message: `Cross-check document ${seed.cross_check_source.location} could not be read: ${err instanceof Error ? err.message : String(err)}; capabilities keep their un-verified confidence.`,
    });
    return undefined;
  }
}
