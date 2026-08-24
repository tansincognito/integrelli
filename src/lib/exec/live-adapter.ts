import type { JsonValue } from '@/types/endpoint';
import type { ExecutionMode, PreparedRequest } from '@/types/execution';
import type { HttpAdapter, RawHttpResponse } from './adapter';

const TIMEOUT_MS = 15_000;
/** Matches the masked placeholders composed by engine.ts, e.g. "Bearer <STRIPE_API_KEY>". */
const ENV_PLACEHOLDER_RE = /<([A-Z0-9_]+)>/g;

function resolveSecrets(value: string): string {
  return value.replace(ENV_PLACEHOLDER_RE, (match, envVar: string) => {
    const resolved = process.env[envVar];
    return resolved !== undefined ? resolved : match;
  });
}

function resolveFlatRecord(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) out[k] = resolveSecrets(v);
  return out;
}

function resolveBodyValue(value: JsonValue): JsonValue {
  if (typeof value === 'string') return resolveSecrets(value);
  if (Array.isArray(value)) return value.map(resolveBodyValue);
  if (value !== null && typeof value === 'object') {
    const out: { [k: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveBodyValue(v);
    return out;
  }
  return value;
}

/**
 * Real fetch adapter. Off by default — only constructed by engine.ts after
 * the live-mode gate (mode flag + every envVar present + INTEGRELLI_ALLOW_LIVE)
 * passes. Secrets are resolved ONLY here, from `<ENV_VAR>` placeholders that
 * were already the masked form stored in the trace's PreparedRequest.
 * Ignores fault injection — that's a test-mode-only concept.
 */
export class LiveAdapter implements HttpAdapter {
  readonly mode: ExecutionMode = 'live';

  async send(req: PreparedRequest): Promise<RawHttpResponse> {
    const headers = resolveFlatRecord(req.headers);
    const query = resolveFlatRecord(req.query);

    const url = new URL(req.url);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    const body = req.body !== null ? resolveBodyValue(req.body) : null;
    const started = performance.now();

    try {
      const response = await fetch(url.toString(), {
        method: req.method,
        headers,
        body: body !== null ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const latencyMs = Math.round(performance.now() - started);

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const text = await response.text();
      let responseBody: JsonValue | null = null;
      if (text.length > 0) {
        try {
          responseBody = JSON.parse(text) as JsonValue;
        } catch {
          responseBody = text;
        }
      }

      return { status: response.status, headers: responseHeaders, body: responseBody, latencyMs };
    } catch (err) {
      const latencyMs = Math.round(performance.now() - started);
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      return {
        status: 0,
        headers: {},
        body: null,
        latencyMs,
        error: {
          type: isTimeout ? 'timeout' : 'network',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
}
