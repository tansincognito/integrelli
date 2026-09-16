'use client';

import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, Download, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/** Exports the compiled plan as a runnable curl+jq bash script — real credentials, real chained requests, real transforms. */
export function CurlExport({ script, planName }: { script: string; planName: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    const blob = new Blob([script], { type: 'text/x-shellscript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${planName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow'}.sh`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-6 rounded-xl border border-border-strong bg-panel">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Terminal size={13} />
          Export as curl script
        </span>
        <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={copy}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-[11px] text-muted-strong transition-colors hover:text-foreground"
          >
            {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
            {copied ? 'copied' : 'copy'}
          </button>
          <button
            type="button"
            onClick={download}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-[11px] text-muted-strong transition-colors hover:text-foreground"
          >
            <Download size={11} />
            download .sh
          </button>
        </span>
      </button>
      <div className={cn('overflow-x-auto border-t border-border px-5 py-4', !expanded && 'hidden')}>
        <pre className="whitespace-pre font-mono text-[11px] leading-relaxed text-muted-strong">{script}</pre>
      </div>
    </div>
  );
}
