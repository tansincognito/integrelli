import type { EndpointSpec, JsonValue } from '@/types';
import { JsonViewer } from '@/components/ui/JsonViewer';

export function ResponseTab({ endpoint }: { endpoint: EndpointSpec }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 text-[11px] font-mono uppercase tracking-wide text-muted">
          Response schema
        </div>
        <JsonViewer value={endpoint.responseSchema as unknown as JsonValue} />
      </div>
      <div>
        <div className="mb-1 text-[11px] font-mono uppercase tracking-wide text-muted">
          Example response
        </div>
        <JsonViewer value={endpoint.exampleResponse} />
      </div>
    </div>
  );
}
