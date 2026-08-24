'use client';

import { useCallback, useEffect } from 'react';
import { Play } from 'lucide-react';
import type { ExecuteResponse } from '@/types';
import { useIntegrelliStore } from '@/lib/state/store';
import { ModeToggle } from './ModeToggle';
import { FaultInjectionPanel } from './FaultInjectionPanel';
import { TraceView } from './TraceView';

export function RunPanel() {
  const plan = useIntegrelliStore((s) => s.plan);
  const seed = useIntegrelliStore((s) => s.seed);
  const setSeed = useIntegrelliStore((s) => s.setSeed);
  const mode = useIntegrelliStore((s) => s.mode);
  const faults = useIntegrelliStore((s) => s.faults);
  const trace = useIntegrelliStore((s) => s.trace);
  const setTrace = useIntegrelliStore((s) => s.setTrace);
  const isRunning = useIntegrelliStore((s) => s.isRunning);
  const setRunning = useIntegrelliStore((s) => s.setRunning);
  const executeError = useIntegrelliStore((s) => s.executeError);
  const setExecuteError = useIntegrelliStore((s) => s.setExecuteError);
  const setEnvStatus = useIntegrelliStore((s) => s.setEnvStatus);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/env-status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setEnvStatus(data);
      })
      .catch(() => {
        /* env-status is best-effort; live mode simply stays disabled */
      });
    return () => {
      cancelled = true;
    };
  }, [setEnvStatus]);

  const runWorkflow = useCallback(async () => {
    if (!plan) return;
    setRunning(true);
    setExecuteError(null);
    try {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, seed, mode, faults }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const missing = Array.isArray(body.missingEnvVars) ? ` Missing: ${body.missingEnvVars.join(', ')}` : '';
        throw new Error((body.error ?? `Execute failed with status ${res.status}`) + missing);
      }
      const data = (await res.json()) as ExecuteResponse;
      setTrace(data.trace);
    } catch (err) {
      setExecuteError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [plan, seed, mode, faults, setTrace, setRunning, setExecuteError]);

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <div className="space-y-2.5 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <label htmlFor="seed-input" className="text-[11px] uppercase tracking-wide text-muted">
            Seed
          </label>
          <input
            id="seed-input"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            className="flex-1 rounded border border-border bg-black/30 px-2 py-1 font-mono text-xs"
          />
        </div>

        <ModeToggle />

        {plan && plan.steps.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Fault injection</div>
            <FaultInjectionPanel steps={plan.steps} />
          </div>
        )}

        <button
          type="button"
          onClick={runWorkflow}
          disabled={!plan || isRunning}
          className="flex w-full items-center justify-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Play size={13} />
          {isRunning ? 'Running…' : 'Run'}
        </button>
        {executeError && <p className="text-xs text-danger">{executeError}</p>}
      </div>

      <div className="flex-1 overflow-y-auto">
        {trace ? (
          <TraceView trace={trace} />
        ) : (
          <p className="text-xs text-muted">No trace yet. Run the workflow to see results here.</p>
        )}
      </div>
    </div>
  );
}
