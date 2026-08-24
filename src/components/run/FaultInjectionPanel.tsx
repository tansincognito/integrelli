'use client';

import type { WorkflowStep } from '@/types';
import { useIntegrelliStore } from '@/lib/state/store';

const FORCEABLE_STATUSES = [429, 500] as const;

export function FaultInjectionPanel({ steps }: { steps: WorkflowStep[] }) {
  const faults = useIntegrelliStore((s) => s.faults);
  const setFault = useIntegrelliStore((s) => s.setFault);

  return (
    <div className="space-y-1">
      {steps.map((step) => {
        const fault = faults.find((f) => f.stepId === step.id) ?? null;
        return (
          <div key={step.id} className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 truncate font-mono text-muted">{step.id}</span>
            <select
              value={fault?.status ?? 'none'}
              onChange={(e) => {
                const value = e.target.value;
                if (value === 'none') {
                  setFault(step.id, null);
                  return;
                }
                setFault(step.id, {
                  status: Number(value) as 429 | 500,
                  applyToAttempts: fault?.applyToAttempts ?? 2,
                });
              }}
              className="rounded border border-border bg-black/30 px-1.5 py-1 font-mono text-[11px]"
            >
              <option value="none">none</option>
              {FORCEABLE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  force {status}
                </option>
              ))}
            </select>
            {fault && (
              <input
                type="number"
                min={1}
                value={fault.applyToAttempts === 'all' ? '' : fault.applyToAttempts}
                placeholder="all"
                title="Leading attempts to fail before succeeding (blank = fail all attempts)"
                onChange={(e) => {
                  const raw = e.target.value;
                  setFault(step.id, {
                    status: fault.status,
                    applyToAttempts: raw === '' ? 'all' : Math.max(1, Number(raw)),
                  });
                }}
                className="w-14 rounded border border-border bg-black/30 px-1.5 py-1 font-mono text-[11px]"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
