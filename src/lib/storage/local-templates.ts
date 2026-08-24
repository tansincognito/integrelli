import type { WorkflowPlan } from '@/types';
import { WorkflowPlanSchema } from '@/schemas/workflow.zod';

export interface SavedTemplate {
  id: string;
  name: string;
  description: string;
  plan: WorkflowPlan;
  savedAt: string;
}

const STORAGE_KEY = 'integrelli.templates.v1';

function hasLocalStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

/** All user-saved templates, newest first. Never throws; corrupt storage yields []. */
export function listLocalTemplates(): SavedTemplate[] {
  if (!hasLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: SavedTemplate[] = [];
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof entry.id === 'string' &&
        typeof entry.name === 'string' &&
        typeof entry.savedAt === 'string' &&
        WorkflowPlanSchema.safeParse(entry.plan).success
      ) {
        valid.push(entry as SavedTemplate);
      }
    }
    return valid.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  }
}

function writeAll(templates: SavedTemplate[]): void {
  if (!hasLocalStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

/** Save (or overwrite by id) the current plan as a named template. */
export function saveLocalTemplate(name: string, description: string, plan: WorkflowPlan): SavedTemplate {
  const existing = listLocalTemplates();
  const template: SavedTemplate = {
    id: `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    description,
    plan,
    savedAt: new Date().toISOString(),
  };
  writeAll([template, ...existing]);
  return template;
}

export function deleteLocalTemplate(id: string): void {
  writeAll(listLocalTemplates().filter((t) => t.id !== id));
}
