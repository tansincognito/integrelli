import type { EndpointSpec, WorkflowStep } from '@/types';
import { ProvenanceBadge } from '@/components/ui/Badge';

interface HeaderRow {
  name: string;
  display: string;
  provenance: 'literal' | 'secret' | 'ref' | 'unresolved';
  required: boolean;
}

function authHeaderRow(endpoint: EndpointSpec): HeaderRow | null {
  const auth = endpoint.auth;
  switch (auth.kind) {
    case 'bearer':
      return { name: 'Authorization', display: `Bearer <${auth.envVar}>`, provenance: 'secret', required: true };
    case 'header':
      return { name: auth.headerName, display: `<${auth.envVar}>`, provenance: 'secret', required: true };
    case 'basic':
      return {
        name: 'Authorization',
        display: `Basic <${auth.usernameEnvVar}:${auth.passwordEnvVar}>`,
        provenance: 'secret',
        required: true,
      };
    case 'query':
      return null; // sent as a query param, not a header
  }
}

function buildHeaderRows(endpoint: EndpointSpec, step: WorkflowStep): HeaderRow[] {
  const rows = new Map<string, HeaderRow>();

  for (const [name, value] of Object.entries(endpoint.headers)) {
    rows.set(name, { name, display: value, provenance: 'literal', required: true });
  }

  const auth = authHeaderRow(endpoint);
  if (auth) rows.set(auth.name, auth);

  for (const mapping of step.mappings) {
    if (mapping.target !== 'header') continue;
    let display: string;
    let provenance: HeaderRow['provenance'];
    switch (mapping.source.kind) {
      case 'literal':
        display = String(mapping.source.value);
        provenance = 'literal';
        break;
      case 'secret':
        display = mapping.path.toLowerCase() === 'authorization'
          ? `Bearer <${mapping.source.envVar}>`
          : `<${mapping.source.envVar}>`;
        provenance = 'secret';
        break;
      case 'ref':
        display = mapping.source.expression;
        provenance = 'ref';
        break;
      case 'unresolved':
        display = `(unresolved: ${mapping.source.reason})`;
        provenance = 'unresolved';
        break;
    }
    rows.set(mapping.path, { name: mapping.path, display, provenance, required: mapping.required });
  }

  return Array.from(rows.values());
}

export function HeadersTab({ endpoint, step }: { endpoint: EndpointSpec; step: WorkflowStep }) {
  const rows = buildHeaderRows(endpoint, step);

  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
          <th className="border-b border-border pb-1.5 pr-3 font-mono font-normal">Header</th>
          <th className="border-b border-border pb-1.5 pr-3 font-mono font-normal">Value</th>
          <th className="border-b border-border pb-1.5 font-mono font-normal">Source</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name}>
            <td className="border-b border-border/50 py-1.5 pr-3 font-mono">{row.name}</td>
            <td className="border-b border-border/50 py-1.5 pr-3 font-mono break-all">{row.display}</td>
            <td className="border-b border-border/50 py-1.5">
              <ProvenanceBadge kind={row.provenance} required={row.required} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
