'use client';

import { useState } from 'react';
import type { FieldMapping, MappingSource, TriggerSpec, WorkflowStep, JsonSchema, JsonValue } from '@/types';
import { byId } from '@/knowledge';
import { cn } from '@/lib/utils/cn';

/** Walk a JSON Schema, collecting dotted/[n] paths up to `depth` levels deep. */
function collectSchemaPaths(schema: JsonSchema | undefined, prefix: string, depth: number): string[] {
  if (!schema || depth <= 0) return [];
  if (schema.type === 'object' && schema.properties) {
    const results: string[] = [];
    for (const [key, child] of Object.entries(schema.properties)) {
      const path = prefix ? `${prefix}.${key}` : key;
      results.push(path);
      results.push(...collectSchemaPaths(child, path, depth - 1));
    }
    return results;
  }
  if (schema.type === 'array' && schema.items) {
    const path = `${prefix}[0]`;
    return [path, ...collectSchemaPaths(schema.items, path, depth - 1)];
  }
  return [];
}

function tryParseJson(text: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}

type EditableKind = 'literal' | 'secret' | 'ref';

/** Edits a single FieldMapping. Saving pushes the change into the store (edit-and-rerun). */
export function MappingEditor({
  mapping,
  trigger,
  priorSteps,
  onSave,
  onCancel,
}: {
  mapping: FieldMapping;
  trigger: TriggerSpec;
  priorSteps: WorkflowStep[];
  onSave: (mapping: FieldMapping) => void;
  onCancel: () => void;
}) {
  const initialKind: EditableKind = mapping.source.kind === 'unresolved' ? 'literal' : mapping.source.kind;
  const [kind, setKind] = useState<EditableKind>(initialKind);
  const [literalValue, setLiteralValue] = useState(
    mapping.source.kind === 'literal' ? JSON.stringify(mapping.source.value) : ''
  );
  const [envVar, setEnvVar] = useState(mapping.source.kind === 'secret' ? mapping.source.envVar : '');
  const [refExpression, setRefExpression] = useState(
    mapping.source.kind === 'ref' ? mapping.source.expression : ''
  );

  const refOptions = [
    ...collectSchemaPaths(trigger.payloadSchema, '', 2).map((p) => `$trigger.payload.${p}`),
    ...priorSteps.flatMap((s) => {
      const endpoint = byId.get(s.endpointId);
      if (!endpoint) return [];
      return collectSchemaPaths(endpoint.responseSchema, '', 2).map((p) => `$steps.${s.id}.response.${p}`);
    }),
  ];

  function buildSource(): MappingSource {
    if (kind === 'literal') return { kind: 'literal', value: tryParseJson(literalValue) };
    if (kind === 'secret') return { kind: 'secret', envVar: envVar.trim().toUpperCase() };
    return { kind: 'ref', expression: refExpression.trim() };
  }

  return (
    <div className="space-y-2 rounded border border-accent/40 bg-black/40 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted">
          {mapping.target}.{mapping.path}
        </span>
        {mapping.required && <span className="text-[10px] uppercase text-danger">required</span>}
      </div>

      <div className="flex gap-1">
        {(['literal', 'secret', 'ref'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={cn(
              'rounded border px-2 py-1 font-mono text-[11px]',
              k === kind ? 'border-accent text-accent' : 'border-border text-muted hover:text-foreground'
            )}
          >
            {k}
          </button>
        ))}
      </div>

      {kind === 'literal' && (
        <input
          value={literalValue}
          onChange={(e) => setLiteralValue(e.target.value)}
          placeholder='e.g. "price_123" or 42'
          className="w-full rounded border border-border bg-black/30 px-2 py-1 font-mono text-xs"
        />
      )}
      {kind === 'secret' && (
        <input
          value={envVar}
          onChange={(e) => setEnvVar(e.target.value)}
          placeholder="STRIPE_API_KEY"
          className="w-full rounded border border-border bg-black/30 px-2 py-1 font-mono text-xs uppercase"
        />
      )}
      {kind === 'ref' && (
        <div className="space-y-1">
          <select
            value={refOptions.includes(refExpression) ? refExpression : ''}
            onChange={(e) => setRefExpression(e.target.value)}
            className="w-full rounded border border-border bg-black/30 px-2 py-1 font-mono text-xs"
          >
            <option value="">Pick a reference…</option>
            {refOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          <input
            value={refExpression}
            onChange={(e) => setRefExpression(e.target.value)}
            placeholder="$steps.step_1.response.id"
            className="w-full rounded border border-border bg-black/30 px-2 py-1 font-mono text-xs"
          />
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-border px-2 py-1 text-[11px] text-muted hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave({ ...mapping, source: buildSource() })}
          className="rounded bg-accent px-2 py-1 text-[11px] font-medium text-accent-foreground hover:bg-accent/90"
        >
          Save
        </button>
      </div>
    </div>
  );
}
