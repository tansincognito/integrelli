'use client';

import { useCallback, useState } from 'react';
import { ArrowRight, Sparkles, Zap } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { PlanResponseBody } from './types';

const EXAMPLES = [
  {
    label: 'Stripe → Gmail',
    request: 'When a Stripe payment succeeds, send an email through Gmail.',
  },
  {
    label: 'ElevenLabs → Stripe → Gmail',
    request:
      'When an ElevenLabs call completes, create a Stripe checkout session and email the link to the customer via Gmail.',
  },
  {
    label: 'Stripe → HubSpot → Slack',
    request: 'When a Stripe payment succeeds, create a HubSpot contact and post a message to Slack.',
  },
];

const PLACEHOLDER = 'When a Stripe payment succeeds, send an email through Gmail.';

export function PromptConsole({
  onResult,
}: {
  onResult: (request: string, body: PlanResponseBody) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const build = useCallback(
    async (request: string) => {
      const trimmed = request.trim();
      if (trimmed.length < 8) {
        setError('Describe the workflow in a full sentence — at least eight characters.');
        return;
      }

      setBusy(true);
      setError(null);
      try {
        const response = await fetch('/api/workflow/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request: trimmed }),
        });
        const body = (await response.json()) as PlanResponseBody & { error?: { message: string } | string };

        // 422 still carries a usable payload: a rejected plan plus its reasons.
        if (!response.ok && !body.plan && !body.retrieval) {
          throw new Error(typeof body.error === 'string' ? body.error : (body.error?.message ?? `Request failed (${response.status})`));
        }
        onResult(trimmed, body);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [onResult]
  );

  return (
    <section className="mx-auto w-full max-w-4xl">
      <h1 className="text-balance text-center text-5xl font-bold tracking-tightest sm:text-6xl">
        What do you want to connect?
      </h1>
      <p className="mx-auto mt-5 max-w-xl text-center text-[15px] leading-relaxed text-muted">
        Describe the outcome in plain language. Every API in the chain is resolved against ingested documentation,
        typed, and validated before it ships.
      </p>

      <div className="mt-12 rounded-xl border border-border-strong bg-panel">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void build(text);
          }}
          rows={3}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          className="w-full resize-none bg-transparent px-6 pb-4 pt-6 font-mono text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted"
        />

        <div className="flex items-center justify-between gap-4 px-6 pb-5">
          <span className="flex items-center gap-2 font-mono text-xs text-muted">
            <Sparkles size={13} />
            Auth, schemas and mappings resolved from the capability graph
          </span>
          <button
            type="button"
            onClick={() => void build(text)}
            disabled={busy}
            className={cn(
              'flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 font-mono text-sm font-semibold text-accent-foreground transition-opacity',
              busy ? 'cursor-not-allowed opacity-60' : 'hover:opacity-90'
            )}
          >
            {busy ? 'Building…' : 'Build'}
            <ArrowRight size={15} />
          </button>
        </div>
      </div>

      {error && <p className="mt-3 font-mono text-xs text-danger">{error}</p>}

      <div className="mt-10">
        <p className="text-sm text-muted">Try an example</p>
        <ul className="mt-3 divide-y divide-border border-y border-border">
          {EXAMPLES.map((example) => (
            <li key={example.label}>
              <button
                type="button"
                onClick={() => {
                  setText(example.request);
                  void build(example.request);
                }}
                className="group flex w-full items-center gap-3 py-3.5 text-left font-mono text-sm text-muted-strong transition-colors hover:text-foreground"
              >
                <Zap size={14} className="text-muted transition-colors group-hover:text-accent" />
                {example.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
