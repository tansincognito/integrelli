import type { ExecutionTrace } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { TraceStepRow } from './TraceStepRow';

const STATUS_TONE = {
  success: 'success',
  partial: 'warning',
  failed: 'danger',
} as const;

export function TraceView({ trace }: { trace: ExecutionTrace }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={STATUS_TONE[trace.status]}>{trace.status}</Badge>
        <span className="font-mono text-muted">seed={trace.seed}</span>
        <span className="font-mono text-muted">mode={trace.mode}</span>
        <span className="font-mono text-muted">{trace.totalDurationMs}ms total</span>
      </div>
      <div className="space-y-1.5">
        {trace.steps.map((result) => (
          <TraceStepRow key={result.stepId} result={result} />
        ))}
      </div>
    </div>
  );
}
