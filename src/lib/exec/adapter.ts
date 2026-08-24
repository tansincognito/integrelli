import type { JsonValue } from '@/types/endpoint';
import type { ExecutionMode, PreparedRequest } from '@/types/execution';

/** DESIGN.md section 6, verbatim. The single live seam — engine.ts never imports fetch. */
export interface RawHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: JsonValue | null;
  latencyMs: number;
  error?: { type: 'network' | 'timeout'; message: string };
}

export interface HttpAdapter {
  readonly mode: ExecutionMode;
  send(
    req: PreparedRequest,
    ctx: { stepId: string; attempt: number; seed: string }
  ): Promise<RawHttpResponse>;
}
