import type { Attempt } from '@/types';
import { StatusBadge, Badge } from '@/components/ui/Badge';

export function AttemptList({ attempts }: { attempts: Attempt[] }) {
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead>
        <tr className="text-left uppercase tracking-wide text-muted">
          <th className="pb-1 pr-3 font-mono font-normal">#</th>
          <th className="pb-1 pr-3 font-mono font-normal">Status</th>
          <th className="pb-1 pr-3 font-mono font-normal">Latency</th>
          <th className="pb-1 pr-3 font-mono font-normal">Backoff</th>
          <th className="pb-1 font-mono font-normal">Fault</th>
        </tr>
      </thead>
      <tbody>
        {attempts.map((attempt) => (
          <tr key={attempt.attempt}>
            <td className="py-0.5 pr-3 font-mono">{attempt.attempt}</td>
            <td className="py-0.5 pr-3">
              <StatusBadge status={attempt.status} />
            </td>
            <td className="py-0.5 pr-3 font-mono">{attempt.latencyMs}ms</td>
            <td className="py-0.5 pr-3 font-mono">{attempt.backoffMs}ms</td>
            <td className="py-0.5">
              {attempt.faultInjected ? <Badge tone="warning">injected</Badge> : null}
            </td>
          </tr>
        ))}
        {attempts
          .filter((attempt) => attempt.error)
          .map((attempt) => (
            <tr key={`${attempt.attempt}-error`}>
              <td />
              <td colSpan={4} className="pb-1 pt-0.5 text-danger">
                attempt {attempt.attempt}: {attempt.error?.message}
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
