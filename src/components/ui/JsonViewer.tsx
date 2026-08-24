'use client';

import { useState, type ReactNode } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { JsonValue } from '@/types';
import { cn } from '@/lib/utils/cn';

function childPath(parentPath: string, key: string, isArray: boolean): string {
  if (isArray) return `${parentPath}[${key}]`;
  return parentPath ? `${parentPath}.${key}` : key;
}

function ValueLabel({ value }: { value: JsonValue }) {
  if (value === null) return <span className="text-muted">null</span>;
  if (typeof value === 'string') return <span className="text-success">&quot;{value}&quot;</span>;
  if (typeof value === 'number') return <span className="text-accent">{value}</span>;
  if (typeof value === 'boolean') return <span className="text-warning">{String(value)}</span>;
  return null;
}

function JsonNode({
  label,
  value,
  path,
  depth,
  annotate,
  defaultCollapsedDepth,
}: {
  label: string | null;
  value: JsonValue;
  path: string;
  depth: number;
  annotate?: (path: string) => ReactNode;
  defaultCollapsedDepth: number;
}) {
  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  const isArray = Array.isArray(value);
  const [open, setOpen] = useState(depth < defaultCollapsedDepth);

  if (!isObject && !isArray) {
    return (
      <div className="flex items-center gap-2 py-0.5 font-mono text-xs" style={{ paddingLeft: depth * 14 }}>
        {label !== null && <span className="text-muted">{label}:</span>}
        <ValueLabel value={value} />
        {annotate?.(path)}
      </div>
    );
  }

  const entries: Array<[string, JsonValue]> = isArray
    ? (value as JsonValue[]).map((v, i) => [String(i), v])
    : Object.entries(value as { [k: string]: JsonValue });

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 py-0.5 font-mono text-xs hover:bg-white/5 rounded"
        style={{ paddingLeft: depth * 14 }}
      >
        {open ? <ChevronDown size={12} className="text-muted shrink-0" /> : <ChevronRight size={12} className="text-muted shrink-0" />}
        {label !== null && <span className="text-muted">{label}:</span>}
        <span className="text-muted">
          {isArray ? `Array(${entries.length})` : `Object{${entries.length}}`}
        </span>
      </button>
      {open && (
        <div>
          {entries.length === 0 && (
            <div className="text-muted font-mono text-xs" style={{ paddingLeft: (depth + 1) * 14 }}>
              (empty)
            </div>
          )}
          {entries.map(([key, v]) => (
            <JsonNode
              key={key}
              label={key}
              value={v}
              path={childPath(path, key, isArray)}
              depth={depth + 1}
              annotate={annotate}
              defaultCollapsedDepth={defaultCollapsedDepth}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Collapsible pretty-printed JSON. Optionally pass `annotate(path)` to
 * render extra content (e.g. a provenance Badge) next to each leaf, where
 * `path` matches the dotted/[n] convention used by FieldMapping.path.
 */
export function JsonViewer({
  value,
  annotate,
  className,
  defaultCollapsedDepth = 4,
}: {
  value: JsonValue;
  annotate?: (path: string) => ReactNode;
  className?: string;
  defaultCollapsedDepth?: number;
}) {
  return (
    <div className={cn('font-mono text-xs', className)}>
      <JsonNode
        label={null}
        value={value}
        path=""
        depth={0}
        annotate={annotate}
        defaultCollapsedDepth={defaultCollapsedDepth}
      />
    </div>
  );
}
