'use client';

import { cn } from '@/lib/utils/cn';

export type ConsoleView = 'workflows' | 'library' | 'runs' | 'docs';

const TABS: Array<{ id: ConsoleView; label: string; enabled: boolean }> = [
  { id: 'workflows', label: 'Workflows', enabled: true },
  { id: 'library', label: 'API Library', enabled: true },
  // Test Runs needs the execution engine, which is not built yet. Shown as a
  // disabled tab rather than a link to an empty page.
  { id: 'runs', label: 'Test Runs', enabled: false },
  { id: 'docs', label: 'Docs', enabled: false },
];

export function TopNav({
  view,
  onChange,
}: {
  view: ConsoleView;
  onChange: (view: ConsoleView) => void;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-6">
        <span className="flex items-center gap-2 text-sm font-semibold tracking-tightest">
          <span className="h-2 w-2 rounded-full bg-accent" />
          Integrelli
        </span>

        <nav className="flex items-center gap-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              disabled={!tab.enabled}
              aria-current={view === tab.id ? 'page' : undefined}
              onClick={() => onChange(tab.id)}
              className={cn(
                'relative py-4 text-sm transition-colors',
                view === tab.id ? 'text-foreground' : 'text-muted',
                tab.enabled ? 'hover:text-foreground' : 'cursor-not-allowed opacity-50'
              )}
              title={tab.enabled ? undefined : 'Not available yet'}
            >
              {tab.label}
              {view === tab.id && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" />}
            </button>
          ))}
        </nav>

        <a
          href="/workspace"
          className="ml-auto rounded-md border border-border-strong px-3 py-1.5 font-mono text-xs text-muted-strong transition-colors hover:border-accent hover:text-foreground"
        >
          Workspace
        </a>
      </div>
    </header>
  );
}
