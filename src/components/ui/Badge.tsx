import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-white/5 text-foreground border-border',
  accent: 'bg-accent/15 text-accent border-accent/40',
  success: 'bg-success/15 text-success border-success/40',
  warning: 'bg-warning/15 text-warning border-warning/40',
  danger: 'bg-danger/15 text-danger border-danger/50',
};

const METHOD_TONES: Record<string, BadgeTone> = {
  GET: 'accent',
  POST: 'success',
  PUT: 'warning',
  PATCH: 'warning',
  DELETE: 'danger',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
  loud = false,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  /** Extra-visible treatment, e.g. for unresolved-required fields. */
  loud?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-mono uppercase tracking-wide leading-none',
        TONE_CLASSES[tone],
        loud && 'animate-pulse ring-1 ring-danger',
        className
      )}
    >
      {children}
    </span>
  );
}

export function MethodBadge({ method }: { method: string }) {
  return <Badge tone={METHOD_TONES[method] ?? 'neutral'}>{method}</Badge>;
}

export function StatusBadge({ status }: { status: number | null }) {
  if (status === null) return <Badge tone="neutral">—</Badge>;
  const tone: BadgeTone = status >= 200 && status < 300 ? 'success' : status === 429 ? 'warning' : 'danger';
  return <Badge tone={tone}>{status}</Badge>;
}

const PROVENANCE_TONES: Record<string, BadgeTone> = {
  literal: 'neutral',
  secret: 'accent',
  ref: 'success',
  unresolved: 'danger',
};

export function ProvenanceBadge({ kind, required = false }: { kind: string; required?: boolean }) {
  return (
    <Badge tone={PROVENANCE_TONES[kind] ?? 'neutral'} loud={kind === 'unresolved' && required}>
      {kind}
    </Badge>
  );
}
