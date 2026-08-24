'use client';

import { ChevronRight, ChevronDown } from 'lucide-react';
import type { WorkflowStep, TriggerSpec, StepStatus } from '@/types';
import { byId } from '@/knowledge';
import { useIntegrelliStore, type InspectorTab } from '@/lib/state/store';
import { MethodBadge, Badge } from '@/components/ui/Badge';
import { Tabs, type TabDef } from '@/components/ui/Tabs';
import { EndpointTab } from './EndpointTab';
import { HeadersTab } from './HeadersTab';
import { RequestTab } from './RequestTab';
import { ResponseTab } from './ResponseTab';
import { cn } from '@/lib/utils/cn';

const TABS: TabDef[] = [
  { id: 'endpoint', label: 'Endpoint' },
  { id: 'headers', label: 'Headers' },
  { id: 'request', label: 'Request' },
  { id: 'response', label: 'Response' },
];

const STATUS_DOT: Record<StepStatus, string> = {
  success: 'bg-success',
  failed: 'bg-danger',
  skipped: 'bg-warning',
};

export function StepCard({
  step,
  trigger,
  priorSteps,
}: {
  step: WorkflowStep;
  trigger: TriggerSpec;
  priorSteps: WorkflowStep[];
}) {
  const expandedStepId = useIntegrelliStore((s) => s.expandedStepId);
  const setExpandedStep = useIntegrelliStore((s) => s.setExpandedStep);
  const activeTab = useIntegrelliStore((s) => s.activeTab);
  const setActiveTab = useIntegrelliStore((s) => s.setActiveTab);
  const trace = useIntegrelliStore((s) => s.trace);

  const endpoint = byId.get(step.endpointId);
  const expanded = expandedStepId === step.id;
  const result = trace?.steps.find((r) => r.stepId === step.id) ?? null;

  if (!endpoint) {
    return (
      <div className="rounded-md border border-danger/50 bg-danger/5 px-3 py-2 text-xs text-danger">
        Unknown endpoint id &quot;{step.endpointId}&quot; for step {step.id}.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setExpandedStep(expanded ? null : step.id)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {expanded ? (
          <ChevronDown size={14} className="shrink-0 text-muted" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-muted" />
        )}
        <span className="font-mono text-xs text-muted">#{step.order + 1}</span>
        <Badge tone="neutral">{endpoint.serviceLabel}</Badge>
        <MethodBadge method={endpoint.method} />
        <span className="truncate font-mono text-xs">{endpoint.path}</span>
        <span className="ml-auto truncate text-xs text-muted">{step.title}</span>
        {result && <span className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[result.status])} title={result.status} />}
      </button>
      {expanded && (
        <div className="border-t border-border">
          <Tabs tabs={TABS} activeId={activeTab} onChange={(id) => setActiveTab(id as InspectorTab)}>
            {activeTab === 'endpoint' && <EndpointTab endpoint={endpoint} step={step} />}
            {activeTab === 'headers' && <HeadersTab endpoint={endpoint} step={step} />}
            {activeTab === 'request' && (
              <RequestTab endpoint={endpoint} step={step} trigger={trigger} priorSteps={priorSteps} />
            )}
            {activeTab === 'response' && <ResponseTab endpoint={endpoint} />}
          </Tabs>
        </div>
      )}
    </div>
  );
}
