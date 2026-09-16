import { AlertOctagon, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { WorkflowRisk } from './types';

/** Structural risks computable from the plan alone: which steps could break under retry or rate-limit pressure. */
export function RiskPanel({ risks }: { risks: WorkflowRisk[] }) {
  if (risks.length === 0) return null;

  return (
    <div className="mt-6 rounded-xl border border-border-strong bg-panel px-5 py-4">
      <p className="font-mono text-xs uppercase tracking-wider text-muted">Bottlenecks &amp; risks</p>
      <ul className="mt-3 flex flex-col gap-2">
        {risks.map((risk, index) => (
          <li
            key={index}
            className={cn(
              'flex gap-2.5 rounded-lg border px-4 py-2.5 text-xs',
              risk.severity === 'high' ? 'border-danger/30 text-danger' : 'border-warning/30 text-warning'
            )}
          >
            {risk.severity === 'high' ? (
              <AlertOctagon size={14} className="mt-0.5 shrink-0" />
            ) : (
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            )}
            <span className="min-w-0 text-muted-strong">
              <span className="font-mono text-foreground">{risk.step_id}</span> — {risk.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
