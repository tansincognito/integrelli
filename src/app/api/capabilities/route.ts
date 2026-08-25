import { NextResponse } from 'next/server';
import { loadStore } from '@/knowledge/store';

export const runtime = 'nodejs';

/**
 * GET /api/capabilities
 *
 * The ingested capability graph, grouped by provider — what the API Library tab
 * renders. Exposes provenance and confidence, and nothing that could carry a
 * credential: `env_var_name` is a name, and it is not returned here at all.
 */
export function GET(): NextResponse {
  const { store, implementationsByCapability } = loadStore();

  const providers = store.providers.map((provider) => {
    const version = store.api_versions.find((candidate) => candidate.provider_id === provider.id);

    return {
      id: provider.id,
      name: provider.name,
      version: version?.version ?? 'unknown',
      status: version?.status ?? 'unknown',
      source_label: provider.documentation_source.label,
      upstream_url: provider.documentation_source.upstream_url,
      capabilities: store.capabilities
        .filter((capability) => capability.provider_id === provider.id)
        .map((capability) => {
          const implementation = implementationsByCapability.get(capability.id)?.[0];
          return {
            id: capability.id,
            name: capability.name,
            kind: capability.kind,
            description: capability.description,
            category: capability.category,
            confidence: capability.confidence,
            extractor: capability.source.extractor,
            method: implementation?.method ?? null,
            endpoint: implementation?.endpoint ?? '',
            input_count: capability.inputs.length,
            output_count: capability.outputs.length,
          };
        }),
    };
  });

  return NextResponse.json({ built_at: store.built_at, providers }, { status: 200 });
}
