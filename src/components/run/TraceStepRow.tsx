'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { StepResult, StepStatus } from '@/types';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { AttemptList } from './AttemptList';
import { cn } from '@/lib/utils/cn';

const STATUS_TONE: Record<StepStatus, 'success' | 'danger' | 'warning'> = {
  success: 'success',
  failed: 'danger',
  skipped: 'warning',
};

export function TraceStepRow({ result }: { result: StepResult }) {
  const [open, setOpen] = useState(false);
  const lastAttempt = result.attempts[result.attempts.length - 1];

  return (
    <div className="rounded border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs"
      >
        {open ? <ChevronDown size={12} className="text-muted" /> : <ChevronRight size={12} className="text-muted" />}
        <span className="font-mono text-muted">{result.stepId}</span>
        <Badge tone={STATUS_TONE[result.status]}>{result.status}</Badge>
        <StatusBadge status={result.finalStatus} />
        <span className={cn('font-mono text-muted')}>{result.totalDurationMs}ms</span>
        <span className="font-mono text-muted">
          {result.attempts.length} attempt{result.attempts.length === 1 ? '' : 's'}
        </span>
        {result.rateLimit?.warning && (
          <Badge tone="warning" className="ml-auto">
            {result.rateLimit.warning}
          </Badge>
        )}
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border px-2 py-1.5">
          {result.status === 'failed' && lastAttempt?.error && (
            <p className="text-[11px] text-danger">{lastAttempt.error.message}</p>
          )}
          {result.issues.length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-danger">
              {result.issues.map((issue, i) => (
                <li key={i}>{issue.message}</li>
              ))}
            </ul>
          )}
          {result.attempts.length > 0 ? (
            <AttemptList attempts={result.attempts} />
          ) : (
            <p className="text-[11px] text-muted">Never dispatched.</p>
          )}
        </div>
      )}
    </div>
  );
}
