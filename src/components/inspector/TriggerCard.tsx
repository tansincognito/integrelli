import { Radio } from 'lucide-react';
import type { TriggerSpec } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { JsonViewer } from '@/components/ui/JsonViewer';

export function TriggerCard({ trigger }: { trigger: TriggerSpec }) {
  return (
    <div className="rounded-md border border-border bg-white/[0.02]">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Radio size={14} className="text-accent" />
        <span className="font-mono text-xs text-muted">trigger</span>
        <span className="font-mono text-sm">{trigger.eventName}</span>
        <Badge tone="neutral" className="ml-auto">
          described, not a live listener
        </Badge>
      </div>
      <div className="space-y-2 px-3 py-2">
        <p className="text-xs text-muted">{trigger.description}</p>
        <div>
          <div className="mb-1 text-[11px] font-mono uppercase tracking-wide text-muted">
            Sample payload
          </div>
          <JsonViewer value={trigger.samplePayload} />
        </div>
      </div>
    </div>
  );
}
