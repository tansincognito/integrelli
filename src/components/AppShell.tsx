import { PromptBar } from './PromptBar';
import { TemplateBar } from './TemplateBar';
import { ImportExportButtons } from './ImportExportButtons';
import { WorkflowInspector } from './inspector/WorkflowInspector';
import { RunPanel } from './run/RunPanel';

/** 3-pane layout only. Reads nothing from the store — all children are self-sufficient. */
export default function AppShell() {
  return (
    <div className="flex h-screen min-w-[1280px] flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-2">
        <div className="text-sm font-semibold tracking-tight">
          <span className="text-accent">Integrelli</span>
        </div>
        <TemplateBar />
        <ImportExportButtons />
      </header>

      <div className="border-b border-border px-4 py-3">
        <PromptBar />
      </div>

      <main className="grid flex-1 grid-cols-[1fr_420px] overflow-hidden">
        <section className="overflow-y-auto border-r border-border px-4 py-3">
          <WorkflowInspector />
        </section>
        <aside className="overflow-hidden px-4 py-3">
          <RunPanel />
        </aside>
      </main>
    </div>
  );
}
