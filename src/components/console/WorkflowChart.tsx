'use client';

import { useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Gauge, KeyRound, RefreshCw, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { PresentedField, PresentedMapping, PresentedStep } from './types';

/**
 * The compiled plan as a flow chart: one card per step, connected in
 * execution order, each showing exactly what it needs to run — its
 * credential, and every required field with either where its value comes
 * from or an explicit "missing" flag. Replaces a flat step list + a
 * separately-listed, hard-to-parse mapping string per field.
 */
export function WorkflowChart({ steps }: { steps: PresentedStep[] }) {
  return (
    <div className="flex flex-col items-stretch gap-0 lg:flex-row lg:items-stretch">
      {steps.map((step, index) => (
        <div key={step.step_id} className="flex flex-col items-stretch lg:flex-row">
          <StepCard step={step} index={index} />
          {index < steps.length - 1 && (
            <div className="flex shrink-0 items-center justify-center py-2 lg:px-2 lg:py-0">
              <ArrowRight size={18} className="rotate-90 text-muted lg:rotate-0" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function StepCard({ step, index }: { step: PresentedStep; index: number }) {
  const requiredCredential = step.authentication.kind !== 'none';

  return (
    <div
      className={cn(
        'flex w-full flex-col gap-3 rounded-xl border bg-panel px-4 py-3.5 lg:w-80',
        step.ready ? 'border-border-strong' : 'border-danger/40'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-muted">{String(index + 1).padStart(2, '0')}</span>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide',
              step.kind === 'event' ? 'bg-accent/15 text-accent' : 'border border-border text-muted-strong'
            )}
          >
            {step.kind}
          </span>
        </div>
        <StatusPill ready={step.ready} missingCount={step.missing_required_count} />
      </div>

      <div>
        <p className="font-mono text-sm text-foreground">
          <span className="text-accent">{step.provider_id}</span>
          <span className="text-muted">.</span>
          {step.capability_id.slice(step.provider_id.length + 1)}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-strong">{step.purpose}</p>
      </div>

      {requiredCredential && (
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-black/20 px-2 py-1 font-mono text-[11px] text-muted-strong">
          <KeyRound size={11} className="shrink-0 text-warning" />
          {step.authentication.env_var_name ? (
            <span className="break-all">
              requires <span className="text-warning">{step.authentication.env_var_name}</span>
            </span>
          ) : (
            <span>requires credential ({step.authentication.kind})</span>
          )}
        </div>
      )}

      {step.kind === 'action' && (
        <div className="flex flex-wrap gap-1.5 font-mono text-[10px] text-muted-strong">
          {step.rate_limits && (
            <span
              className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5"
              title={step.rate_limits.note}
            >
              <Gauge size={10} className="shrink-0" />
              {step.rate_limits.requests ?? '?'}/{step.rate_limits.window_seconds ?? '?'}s
            </span>
          )}
          <span
            className={cn(
              'flex items-center gap-1 rounded border px-1.5 py-0.5',
              step.idempotency.supported ? 'border-border' : 'border-warning/30 text-warning'
            )}
            title={step.idempotency.mechanism}
          >
            <RefreshCw size={10} className="shrink-0" />
            {step.idempotency.supported ? 'idempotent' : 'not idempotent — retries may duplicate'}
          </span>
        </div>
      )}

      {step.fields.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-border pt-2.5">
          {step.fields.map((field) => (
            <FieldRow key={field.path} field={field} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusPill({ ready, missingCount }: { ready: boolean; missingCount: number }) {
  if (ready) {
    return (
      <span className="flex items-center gap-1 rounded-md border border-success/40 px-1.5 py-0.5 font-mono text-[10px] text-success">
        <CheckCircle2 size={11} />
        ready
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 rounded-md border border-danger/40 px-1.5 py-0.5 font-mono text-[10px] text-danger">
      <XCircle size={11} />
      {missingCount} missing
    </span>
  );
}

function FieldRow({ field }: { field: PresentedField }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = field.mapping?.kind === 'template';

  return (
    <li style={{ marginLeft: field.depth * 12 }}>
      <div className="flex items-start gap-1.5">
        {field.status === 'mapped' ? (
          <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-success" />
        ) : (
          <XCircle size={12} className="mt-0.5 shrink-0 text-danger" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="break-all font-mono text-xs text-foreground">{field.path}</span>
            {field.required && <span className="text-[9px] uppercase tracking-wide text-muted">required</span>}
            {canExpand && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center text-muted transition-colors hover:text-foreground"
                aria-label={expanded ? 'Hide composed message' : 'Show composed message'}
              >
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
            )}
          </div>
          {field.status === 'mapped' ? (
            <MappingSummary mapping={field.mapping} />
          ) : (
            <MissingFieldHint field={field} />
          )}
          {expanded && field.mapping && (
            <pre className="mt-1 whitespace-pre-wrap break-words rounded border border-border bg-black/30 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted-strong">
              {field.mapping.raw}
            </pre>
          )}
        </div>
      </div>
    </li>
  );
}

function MappingSummary({ mapping }: { mapping?: PresentedMapping }) {
  if (!mapping) return null;
  const toneClass = mapping.kind === 'implied' ? 'text-muted italic' : 'text-muted-strong';

  return (
    <p className={cn('text-[11px]', toneClass)}>
      {mapping.summary}
      {mapping.transform && <span className="ml-1.5 text-accent">via {mapping.transform}</span>}
    </p>
  );
}

/** What a "missing" field actually needs — the upstream API's own type/description/allowed values, not just a bare rejection. */
function MissingFieldHint({ field }: { field: PresentedField }) {
  return (
    <div className="text-[11px] text-danger">
      <p>
        not provided — provide{' '}
        <span className="font-mono text-danger/90">
          {field.type}
          {field.format ? `(${field.format})` : ''}
        </span>
      </p>
      {field.description && <p className="mt-0.5 text-muted-strong">{field.description}</p>}
      {field.enum && field.enum.length > 0 && (
        <p className="mt-0.5 text-muted-strong">
          one of: <span className="font-mono text-accent">{field.enum.join(', ')}</span>
        </p>
      )}
    </div>
  );
}
