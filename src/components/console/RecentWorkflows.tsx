'use client';

import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { relativeTime, type RecentWorkflow } from '@/lib/storage/recent-workflows';

/**
 * Workflows built in this browser. There is no server-side workflow store yet,
 * so this list is empty until the user builds something — no placeholder rows.
 */
export function RecentWorkflows({
  workflows,
  onSelect,
}: {
  workflows: RecentWorkflow[];
  onSelect: (workflow: RecentWorkflow) => void;
}) {
  return (
    <section className="mx-auto mt-24 w-full max-w-5xl">
      <div className="flex items-baseline justify-between border-b border-border pb-3">
        <h2 className="text-sm font-medium">Recent workflows</h2>
        <span className="font-mono text-xs text-muted">{workflows.length} stored locally</span>
      </div>

      {workflows.length === 0 ? (
        <p className="py-8 text-sm text-muted">
          Nothing built yet. Describe a workflow above and it will appear here.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {workflows.map((workflow) => (
            <li key={workflow.id}>
              <button
                type="button"
                onClick={() => onSelect(workflow)}
                className="group flex w-full items-center gap-4 py-4 text-left"
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    workflow.valid ? 'bg-accent' : 'bg-danger'
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{workflow.name}</span>
                <span className="shrink-0 font-mono text-xs text-muted">
                  {workflow.provider_count} {workflow.provider_count === 1 ? 'API' : 'APIs'}
                </span>
                <span className="w-24 shrink-0 text-right font-mono text-xs text-muted">
                  {relativeTime(workflow.created_at)}
                </span>
                <ChevronRight size={15} className="shrink-0 text-muted transition-colors group-hover:text-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
