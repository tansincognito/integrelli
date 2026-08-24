'use client';

import { useIntegrelliStore } from '@/lib/state/store';
import { byId } from '@/knowledge';
import { cn } from '@/lib/utils/cn';

export function ModeToggle() {
  const mode = useIntegrelliStore((s) => s.mode);
  const setMode = useIntegrelliStore((s) => s.setMode);
  const envStatus = useIntegrelliStore((s) => s.envStatus);
  const plan = useIntegrelliStore((s) => s.plan);

  const liveReady =
    envStatus?.allowLive === true &&
    (!plan ||
      plan.steps.every((step) => {
        const endpoint = byId.get(step.endpointId);
        return endpoint ? envStatus.services[endpoint.service]?.ready === true : true;
      }));

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-[11px] uppercase tracking-wide text-muted">Mode</span>
      <button
        type="button"
        onClick={() => setMode('test')}
        className={cn(
          'rounded border px-2 py-1 font-mono',
          mode === 'test' ? 'border-accent text-accent' : 'border-border text-muted hover:text-foreground'
        )}
      >
        test
      </button>
      <div className="group relative">
        <button
          type="button"
          disabled={!liveReady}
          onClick={() => liveReady && setMode('live')}
          className={cn(
            'rounded border px-2 py-1 font-mono',
            mode === 'live' ? 'border-accent text-accent' : 'border-border text-muted',
            !liveReady && 'cursor-not-allowed opacity-40'
          )}
        >
          live
        </button>
        {!liveReady && (
          <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 w-60 rounded border border-border bg-black/90 p-2 text-[11px] normal-case text-muted opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
            Live mode requires INTEGRELLI_ALLOW_LIVE=true and every step&apos;s provider key present
            (see /api/env-status).
          </div>
        )}
      </div>
    </div>
  );
}
