'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadRecentWorkflows, saveRecentWorkflow, type RecentWorkflow } from '@/lib/storage/recent-workflows';
import { ApiLibrary } from './ApiLibrary';
import { PlanResult } from './PlanResult';
import { PromptConsole } from './PromptConsole';
import { RecentWorkflows } from './RecentWorkflows';
import { TopNav, type ConsoleView } from './TopNav';
import type { PlanResponseBody } from './types';

/** Root of the console: prompt → plan, plus the ingested capability library. */
export function ConsoleShell() {
  const [view, setView] = useState<ConsoleView>('workflows');
  const [result, setResult] = useState<{ request: string; body: PlanResponseBody } | null>(null);
  const [recents, setRecents] = useState<RecentWorkflow[]>([]);

  // localStorage is only readable after mount; starting empty keeps the server
  // and first client render identical.
  useEffect(() => setRecents(loadRecentWorkflows()), []);

  const handleResult = useCallback((request: string, body: PlanResponseBody) => {
    setResult({ request, body });

    const providers = new Set(body.plan?.steps.map((step) => step.capability.split('.')[0]) ?? []);
    setRecents(
      saveRecentWorkflow({
        id: `wf_${request.length}_${request.slice(0, 24)}`,
        name: body.plan?.name ?? request.slice(0, 60),
        request,
        provider_count: providers.size,
        step_count: body.plan?.steps.length ?? 0,
        valid: body.validation?.valid ?? false,
        created_at: new Date().toISOString(),
      })
    );
  }, []);

  return (
    <div className="grid-backdrop min-h-screen">
      <TopNav
        view={view}
        onChange={(next) => {
          setView(next);
          if (next === 'workflows') setResult(null);
        }}
      />

      <main className="relative z-10 px-6 pb-32 pt-24">
        {view === 'library' ? (
          <ApiLibrary />
        ) : result ? (
          <PlanResult request={result.request} body={result.body} onBack={() => setResult(null)} />
        ) : (
          <>
            <PromptConsole onResult={handleResult} />
            <RecentWorkflows
              workflows={recents}
              onSelect={(workflow) => {
                // Re-planning is a fresh request: the capability graph may have
                // changed since this workflow was built, so nothing is replayed
                // from local storage except the original sentence.
                navigator.clipboard?.writeText(workflow.request).catch(() => undefined);
              }}
            />
          </>
        )}
      </main>
    </div>
  );
}
