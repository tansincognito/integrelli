import type { EndpointSpec, WorkflowStep } from '@/types';

function describeAuth(auth: EndpointSpec['auth']): string {
  switch (auth.kind) {
    case 'bearer':
      return `Bearer token via ${auth.envVar}`;
    case 'header':
      return `Header "${auth.headerName}" via ${auth.envVar}`;
    case 'basic':
      return `Basic auth via ${auth.usernameEnvVar}:${auth.passwordEnvVar}`;
    case 'query':
      return `Query param "${auth.paramName}" via ${auth.envVar}`;
  }
}

/** Resolve the path template against path-target mappings for display. */
export function resolvePathPreview(endpoint: EndpointSpec, step: WorkflowStep): string {
  return endpoint.path.replace(/:([a-zA-Z0-9_]+)/g, (match, name: string) => {
    const mapping = step.mappings.find((m) => m.target === 'path' && m.path === name);
    if (!mapping) return match;
    switch (mapping.source.kind) {
      case 'literal':
        return encodeURIComponent(String(mapping.source.value));
      case 'secret':
        return `<${mapping.source.envVar}>`;
      case 'ref':
        return `{${mapping.source.expression}}`;
      case 'unresolved':
        return match;
    }
  });
}

export function EndpointTab({ endpoint, step }: { endpoint: EndpointSpec; step: WorkflowStep }) {
  const url = `${endpoint.baseUrl}${resolvePathPreview(endpoint, step)}`;

  return (
    <div className="space-y-3 text-xs">
      <div>
        <div className="mb-1 text-[11px] font-mono uppercase tracking-wide text-muted">URL</div>
        <div className="break-all rounded border border-border bg-black/30 px-2 py-1.5 font-mono">
          <span className="text-accent">{endpoint.method}</span> {url}
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-muted">API version</dt>
        <dd className="font-mono">{endpoint.apiVersion}</dd>
        <dt className="text-muted">Auth</dt>
        <dd className="font-mono">{describeAuth(endpoint.auth)}</dd>
        <dt className="text-muted">Service</dt>
        <dd>{endpoint.serviceLabel}</dd>
      </dl>
      <div>
        <div className="mb-1 text-[11px] font-mono uppercase tracking-wide text-muted">
          Description
        </div>
        <p className="text-muted">{endpoint.description}</p>
      </div>
      <div>
        <div className="mb-1 text-[11px] font-mono uppercase tracking-wide text-muted">
          Rationale for this step
        </div>
        <p>{step.rationale}</p>
      </div>
    </div>
  );
}
