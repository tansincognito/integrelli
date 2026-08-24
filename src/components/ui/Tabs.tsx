'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export interface TabDef {
  id: string;
  label: string;
}

/** Minimal accessible tabs. Fully controlled by the parent. */
export function Tabs({
  tabs,
  activeId,
  onChange,
  children,
}: {
  tabs: TabDef[];
  activeId: string;
  onChange: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-border px-2">
        {tabs.map((tab) => {
          const selected = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(tab.id)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors',
                selected
                  ? 'border-accent text-foreground'
                  : 'border-transparent text-muted hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="p-3">
        {children}
      </div>
    </div>
  );
}
