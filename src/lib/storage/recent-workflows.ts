/**
 * Recent workflows, stored in the browser.
 *
 * There is no workflow persistence layer yet, so this records what the user
 * actually built in this browser rather than showing invented rows.
 */
const STORAGE_KEY = 'integrelli.recent-workflows.v1';
const MAX_ENTRIES = 8;

export interface RecentWorkflow {
  id: string;
  name: string;
  request: string;
  provider_count: number;
  step_count: number;
  valid: boolean;
  created_at: string;
}

export function loadRecentWorkflows(): RecentWorkflow[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentWorkflow[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

export function saveRecentWorkflow(entry: RecentWorkflow): RecentWorkflow[] {
  if (typeof window === 'undefined') return [];
  const next = [entry, ...loadRecentWorkflows().filter((item) => item.request !== entry.request)].slice(0, MAX_ENTRIES);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked — the list is a convenience, not state we own.
  }
  return next;
}

/** "2m ago", "yesterday", "3d ago". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const elapsed = now - new Date(iso).getTime();
  if (Number.isNaN(elapsed)) return 'unknown';

  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}
