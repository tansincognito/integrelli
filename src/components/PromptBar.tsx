'use client';

import { useCallback, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { PlanResponse } from '@/types';
import { useIntegrelliStore } from '@/lib/state/store';
import { cn } from '@/lib/utils/cn';

const EXAMPLE_PROMPTS = [
  'When an ElevenLabs call completes, create a Stripe payment link for the customer and email it to them via Gmail.',
  'When a call transcript arrives, save it as a Notion page and post a summary to Slack.',
  'When an OpenAI summary finishes, email it to the customer via Gmail.',
];

export function PromptBar() {
  const [text, setText] = useState('');
  const plan = useIntegrelliStore((s) => s.plan);
  const isGenerating = useIntegrelliStore((s) => s.isGenerating);
  const planError = useIntegrelliStore((s) => s.planError);
  const setGenerating = useIntegrelliStore((s) => s.setGenerating);
  const setPlanError = useIntegrelliStore((s) => s.setPlanError);
  const setPlan = useIntegrelliStore((s) => s.setPlan);

  const generate = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (trimmed.length < 3) {
        setPlanError('Prompt must be at least 3 characters.');
        return;
      }
      setGenerating(true);
      setPlanError(null);
      try {
        const res = await fetch('/api/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: trimmed }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body.error ?? `Plan generation failed with status ${res.status}`);
        }
        setPlan((body as PlanResponse).plan);
      } catch (err) {
        setPlanError(err instanceof Error ? err.message : String(err));
      } finally {
        setGenerating(false);
      }
    },
    [setGenerating, setPlanError, setPlan]
  );

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe the workflow you want, e.g. &quot;When an ElevenLabs call completes, create a Stripe payment link and email it via Gmail.&quot;"
          rows={2}
          className="flex-1 resize-none rounded border border-border bg-black/30 px-3 py-2 font-mono text-xs placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void generate(text)}
          disabled={isGenerating}
          className="flex items-center gap-1.5 self-start rounded bg-accent px-3 py-2 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Sparkles size={13} />
          {isGenerating ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {planError && <p className="text-xs text-danger">{planError}</p>}

      {!plan && (
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLE_PROMPTS.map((example, i) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                setText(example);
                void generate(example);
              }}
              className={cn(
                'max-w-xs rounded border border-border px-2 py-1 text-left text-[11px] text-muted transition-colors hover:border-accent hover:text-foreground',
                i === 0 && 'border-accent/50 text-foreground'
              )}
            >
              {example}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
