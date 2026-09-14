import AppShell from '@/components/AppShell';

/**
 * The endpoint-level workspace built before the capability graph existed:
 * prompt bar, workflow inspector, mock run panel. Kept reachable while the
 * console is being rebuilt on top of the capability model.
 */
export default function WorkspacePage() {
  return <AppShell />;
}
