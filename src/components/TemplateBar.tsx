'use client';

import { useState } from 'react';
import { FolderOpen, Save } from 'lucide-react';
import { BUILTIN_TEMPLATES } from '@/templates';
import type { WorkflowPlan } from '@/types';
import { useIntegrelliStore } from '@/lib/state/store';
import { listLocalTemplates, saveLocalTemplate } from '@/lib/storage/local-templates';

export function TemplateBar() {
  const plan = useIntegrelliStore((s) => s.plan);
  const setPlan = useIntegrelliStore((s) => s.setPlan);
  const [userTemplates, setUserTemplates] = useState(() => listLocalTemplates());

  function handleSaveCurrent() {
    if (!plan) return;
    const name = window.prompt('Template name', plan.name);
    if (!name) return;
    saveLocalTemplate(name, plan.description, plan);
    setUserTemplates(listLocalTemplates());
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-muted">Templates</span>
      {BUILTIN_TEMPLATES.map((template) => (
        <button
          key={template.id}
          type="button"
          onClick={() => setPlan(template.plan as WorkflowPlan)}
          title={template.description}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-accent hover:text-foreground"
        >
          <FolderOpen size={11} />
          {template.name}
        </button>
      ))}
      {userTemplates.map((template) => (
        <button
          key={template.id}
          type="button"
          onClick={() => setPlan(template.plan)}
          title={template.description}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-accent hover:text-foreground"
        >
          <FolderOpen size={11} />
          {template.name}
        </button>
      ))}
      <button
        type="button"
        onClick={handleSaveCurrent}
        disabled={!plan}
        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Save size={11} />
        Save current
      </button>
    </div>
  );
}
