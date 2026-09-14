'use client';

import { useEffect, useState } from 'react';
import type { CapabilityLibraryBody } from './types';

interface RailProvider {
  id: string;
  name: string;
  capabilityCount: number;
}

/**
 * Fixed left-edge rail listing every ingested provider, auto-scrolling
 * vertically forever. Purely a "what's connected" ambient display — clicking
 * a row jumps to the API Library filtered to that provider would be a nice
 * follow-up, but this component reads nothing from and writes nothing to
 * console state, so it can't affect the workflow the user is building.
 */
export function ProviderRail() {
  const [providers, setProviders] = useState<RailProvider[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/capabilities')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body: CapabilityLibraryBody) => {
        if (cancelled) return;
        setProviders(
          body.providers.map((p) => ({ id: p.id, name: p.name, capabilityCount: p.capabilities.length }))
        );
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!providers || providers.length === 0) return null;

  // Duplicated so the marquee can loop by translating exactly -50%, with no seam.
  const track = [...providers, ...providers];

  return (
    <aside
      aria-label="Connected providers"
      className="fixed left-0 top-14 z-10 hidden h-[calc(100vh-3.5rem)] w-40 flex-col border-r border-border bg-background/60 backdrop-blur-sm xl:flex"
    >
      <div className="px-4 pb-2 pt-4 font-mono text-[13px] uppercase tracking-wide text-muted-strong">
        Providers · {providers.length}
      </div>
      <div className="provider-rail-viewport relative flex-1 overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_16px,black_calc(100%-16px),transparent)]">
        <ul className="provider-rail-track absolute inset-x-0 top-0 flex flex-col">
          {track.map((provider, i) => (
            <li key={`${provider.id}-${i}`} className="flex items-center gap-2 px-4 py-3">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_6px_var(--color-accent)]" />
              <span
                className="truncate font-mono text-sm text-accent"
                style={{ textShadow: '0 0 8px var(--color-accent), 0 0 2px var(--color-accent)' }}
              >
                {provider.name}
                <span className="text-accent/60">[{provider.capabilityCount}]</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <style>{`
        @keyframes provider-rail-scroll {
          from { transform: translateY(0); }
          to { transform: translateY(-50%); }
        }
        .provider-rail-track {
          animation: provider-rail-scroll linear infinite;
          animation-duration: ${Math.max(providers.length * 2.2, 8)}s;
        }
        .provider-rail-viewport:hover .provider-rail-track {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .provider-rail-track {
            animation: none;
          }
        }
      `}</style>
    </aside>
  );
}
