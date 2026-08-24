'use client';

import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { useIntegrelliStore } from '@/lib/state/store';
import { downloadPlan, readWorkflowFile } from '@/lib/io/workflow-file';

export function ImportExportButtons() {
  const plan = useIntegrelliStore((s) => s.plan);
  const setPlan = useIntegrelliStore((s) => s.setPlan);
  const [importError, setImportError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    const result = await readWorkflowFile(file);
    if (result.ok) {
      setPlan(result.plan);
      setImportError(null);
    } else {
      setImportError(result.error);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => plan && downloadPlan(plan)}
        disabled={!plan}
        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Download size={11} />
        Export
      </button>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-accent hover:text-foreground"
      >
        <Upload size={11} />
        Import
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />
      {importError && <span className="max-w-xs truncate text-[11px] text-danger" title={importError}>{importError}</span>}
    </div>
  );
}
