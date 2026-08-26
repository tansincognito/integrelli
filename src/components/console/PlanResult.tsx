'use client';

import { useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Play, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { ExecutionTrace } from '@/types';
import { TraceView } from '@/components/run/TraceView';
import type { PlanResponseBody } from './types';

/**
 * What the planner produced, and what the validator made of it.
 *
 * Retrieval similarity and record confidence are shown as two separate columns
 * on purpose — they answer different questions, and collapsing them into one
 * "score" would hide exactly the distinction the knowledge layer exists to make.
 */
export function PlanResult({
  request,
  body,
  onBack,
}: {
  request: string;
  body: PlanResponseBody;
  onBack: () => void;
}) {
  const validation = body.validation;
  const [seed, setSeed] = useState('integrelli');
  const [trace, setTrace] = useState<ExecutionTrace | null>(null);
  const [isRunning, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const runWorkflow = async () => {
    if (!body.plan) return;
    setRunning(true);
    setRunError(null);
    try {
      const res = await fetch('/api/workflow/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: body.plan, seed, faults: [] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Execute failed with status ${res.status}`);
      setTrace(data.trace);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-4xl">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 font-mono text-xs text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft size={13} />
        New workflow
      </button>

      <p className="mt-6 font-mono text-sm leading-relaxed text-muted-strong">{request}</p>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-xs text-muted">
        <span>retrieval: {body.retrieval.method}</span>
        <span>candidates: {body.retrieval.candidates.length}</span>
        <span>LLM calls: {body.llm_calls}</span>
        {body.intent.provider_hints.length > 0 && <span>providers: {body.intent.provider_hints.join(', ')}</span>}
      </div>

      {body.error && (
        <div className="mt-6 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3">
          <p className="font-mono text-xs text-warning">
            {body.error.code}: {body.error.message}
          </p>
        </div>
      )}

      {body.plan && (
        <div className="mt-8 rounded-xl border border-border-strong bg-panel">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">{body.plan.name}</h2>
              <p className="mt-1 text-sm text-muted">{body.plan.description}</p>
            </div>
            {validation && <ValidationBadge valid={validation.valid} />}
          </div>

          <ol className="divide-y divide-border">
            {body.plan.steps.map((step, index) => (
              <li key={step.id} className="flex gap-4 px-5 py-4">
                <span className="mt-0.5 font-mono text-xs text-muted">{String(index + 1).padStart(2, '0')}</span>
                <div className="min-w-0">
                  <p className="font-mono text-sm text-foreground">{step.capability}</p>
                  <p className="mt-1 text-sm text-muted">{step.purpose}</p>
                </div>
              </li>
            ))}
          </ol>

          {body.plan.mappings.length > 0 && (
            <div className="border-t border-border px-5 py-4">
              <p className="font-mono text-xs uppercase tracking-wider text-muted">Mappings</p>
              <ul className="mt-3 space-y-1.5">
                {body.plan.mappings.map((mapping, index) => (
                  <li key={index} className="overflow-x-auto font-mono text-xs text-muted-strong">
                    <span className="text-foreground">{mapping.source}</span>
                    <span className="px-2 text-muted">to</span>
                    <span className="text-foreground">{mapping.destination}</span>
                    {mapping.transform && <span className="ml-2 text-accent">via {mapping.transform}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {validation?.valid && body.plan && (
        <div className="mt-6 rounded-xl border border-border-strong bg-panel px-5 py-4">
          <p className="font-mono text-xs uppercase tracking-wider text-muted">Run (mock mode)</p>
          <div className="mt-3 flex items-center gap-2">
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              className="w-40 rounded border border-border bg-black/30 px-2 py-1 font-mono text-xs"
              aria-label="Seed"
            />
            <button
              type="button"
              onClick={runWorkflow}
              disabled={isRunning}
              className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play size={13} />
              {isRunning ? 'Running…' : 'Run'}
            </button>
          </div>
          {runError && <p className="mt-2 text-xs text-danger">{runError}</p>}
          {trace && (
            <div className="mt-4">
              <TraceView trace={trace} />
            </div>
          )}
        </div>
      )}

      {validation && (validation.errors.length > 0 || validation.warnings.length > 0) && (
        <ul className="mt-4 space-y-2">
          {validation.errors.map((issue, index) => (
            <IssueRow key={`e${index}`} severity="error" code={issue.code} message={issue.message} />
          ))}
          {validation.warnings.map((issue, index) => (
            <IssueRow key={`w${index}`} severity="warning" code={issue.code} message={issue.message} />
          ))}
        </ul>
      )}

      <div className="mt-10">
        <p className="font-mono text-xs uppercase tracking-wider text-muted">Retrieved capabilities</p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse font-mono text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="px-4 py-2.5 font-normal">capability</th>
                <th className="px-4 py-2.5 font-normal">api version</th>
                <th className="px-4 py-2.5 font-normal text-right">similarity</th>
                <th className="px-4 py-2.5 font-normal text-right">confidence</th>
              </tr>
            </thead>
            <tbody>
              {body.retrieval.candidates.map((candidate) => (
                <tr key={candidate.capability_id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 text-foreground">{candidate.capability_id}</td>
                  <td className="px-4 py-2.5 text-muted">{candidate.api_version}</td>
                  <td className="px-4 py-2.5 text-right text-muted-strong">{candidate.similarity_score.toFixed(3)}</td>
                  <td
                    className={cn(
                      'px-4 py-2.5 text-right',
                      candidate.confidence >= 0.9 ? 'text-success' : candidate.confidence >= 0.6 ? 'text-warning' : 'text-danger'
                    )}
                  >
                    {candidate.confidence.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function ValidationBadge({ valid }: { valid: boolean }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-xs',
        valid ? 'border-success/40 text-success' : 'border-danger/40 text-danger'
      )}
    >
      {valid ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
      {valid ? 'validated' : 'rejected'}
    </span>
  );
}

function IssueRow({
  severity,
  code,
  message,
}: {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}) {
  const Icon = severity === 'error' ? XCircle : AlertTriangle;
  return (
    <li
      className={cn(
        'flex gap-2.5 rounded-lg border px-4 py-2.5 font-mono text-xs',
        severity === 'error' ? 'border-danger/30 text-danger' : 'border-warning/30 text-warning'
      )}
    >
      <Icon size={14} className="mt-0.5 shrink-0" />
      <span className="min-w-0">
        <span className="opacity-70">{code}</span> — <span className="text-muted-strong">{message}</span>
      </span>
    </li>
  );
}
