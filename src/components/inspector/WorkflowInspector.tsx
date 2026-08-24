import { AlertTriangle } from 'lucide-react';
import type { WorkflowPlan } from '@/types';
import { TriggerCard } from './TriggerCard';
import { StepCard } from './StepCard';
import { Badge } from '@/components/ui/Badge';

export function WorkflowInspector({ plan }: { plan: WorkflowPlan }) {
  const orderedSteps = [...plan.steps].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{plan.name}</h2>
        <p className="text-xs text-muted">{plan.description}</p>
      </div>

      {plan.issues.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-warning/40 bg-warning/5 px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-warning">
            <AlertTriangle size={14} />
            {plan.issues.length} issue{plan.issues.length === 1 ? '' : 's'} detected
          </div>
          <ul className="space-y-1 text-[11px] text-muted">
            {plan.issues.map((issue, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1.5">
                <Badge tone={issue.severity === 'error' ? 'danger' : 'warning'}>{issue.code}</Badge>
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <TriggerCard trigger={plan.trigger} />

      {orderedSteps.map((step, i) => (
        <StepCard key={step.id} step={step} trigger={plan.trigger} priorSteps={orderedSteps.slice(0, i)} />
      ))}
    </div>
  );
}
