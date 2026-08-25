'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import type { CapabilityLibraryBody } from './types';

/**
 * The ingested capability graph, as it actually exists on disk. Every row here
 * came out of the ingestion pipeline — provider, version, extractor and
 * confidence included, so a low-trust prose extraction is visible as such.
 */
export function ApiLibrary() {
  const [data, setData] = useState<CapabilityLibraryBody | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/capabilities')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((body: CapabilityLibraryBody) => {
        if (!cancelled) setData(body);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="mx-auto max-w-5xl font-mono text-xs text-danger">Could not load the library: {error}</p>;
  if (!data) return <p className="mx-auto max-w-5xl font-mono text-xs text-muted">Loading capability graph…</p>;

  const total = data.providers.reduce((sum, provider) => sum + provider.capabilities.length, 0);

  return (
    <section className="mx-auto w-full max-w-5xl">
      <div className="flex items-baseline justify-between border-b border-border pb-3">
        <h1 className="text-lg font-semibold tracking-tight">API Library</h1>
        <span className="font-mono text-xs text-muted">
          {total} capabilities · {data.providers.length} providers
        </span>
      </div>

      <div className="space-y-10 pt-8">
        {data.providers.map((provider) => (
          <div key={provider.id}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-sm font-medium">{provider.name}</h2>
              <span className="font-mono text-xs text-muted">
                {provider.version} · {provider.status}
              </span>
              <span className="font-mono text-xs text-muted">{provider.source_label}</span>
            </div>

            <div className="mt-3 overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse font-mono text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted">
                    <th className="px-4 py-2.5 font-normal">capability</th>
                    <th className="px-4 py-2.5 font-normal">call</th>
                    <th className="px-4 py-2.5 font-normal">kind</th>
                    <th className="px-4 py-2.5 font-normal">extractor</th>
                    <th className="px-4 py-2.5 font-normal text-right">in / out</th>
                    <th className="px-4 py-2.5 font-normal text-right">confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {provider.capabilities.map((capability) => (
                    <tr key={capability.id} className="border-b border-border last:border-0 align-top">
                      <td className="px-4 py-2.5">
                        <span className="text-foreground">{capability.name}</span>
                        <span className="mt-1 block max-w-md whitespace-normal text-muted">{capability.description}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted-strong">
                        {capability.method ?? '—'} {shortenEndpoint(capability.endpoint)}
                      </td>
                      <td className="px-4 py-2.5 text-muted-strong">{capability.kind}</td>
                      <td className="px-4 py-2.5 text-muted">{capability.extractor}</td>
                      <td className="px-4 py-2.5 text-right text-muted">
                        {capability.input_count} / {capability.output_count}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-2.5 text-right',
                          capability.confidence >= 0.9
                            ? 'text-success'
                            : capability.confidence >= 0.6
                              ? 'text-warning'
                              : 'text-danger'
                        )}
                      >
                        {capability.confidence.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function shortenEndpoint(endpoint: string): string {
  return endpoint.replace(/^https?:\/\/[^/]+/, '');
}
