import type { JsonValue } from '@/types/endpoint';
import type { ExecutionMode, PreparedRequest } from '@/types/execution';
import type { HttpAdapter, RawHttpResponse } from './adapter';
import { getOAuthAccessToken, readOAuthRefreshConfig } from './oauth-token';

const TIMEOUT_MS = 15_000;
/**
 * Matches the masked placeholders composed by engine.ts / capability-engine.ts,
 * e.g. "Bearer <STRIPE_API_KEY>" (a process.env var) or "Bearer <OAUTH:GMAIL>"
 * (resolved via a live refresh-token exchange, see ./oauth-token). Either way
 * the raw secret is never resolved outside this module, and PreparedRequest
 * — what ends up in the trace — keeps the placeholder, never the real value.
 */
const PLACEHOLDER_RE = /<([A-Z0-9_:]+)>/g;

async function resolvePlaceholder(token: string): Promise<string> {
  if (token.startsWith('OAUTH:')) {
    const providerId = token.slice('OAUTH:'.length).toLowerCase();
    const config = readOAuthRefreshConfig(providerId);
    // Gate already required this to be present before live mode was allowed to run.
    if (!config) return `<${token}>`;
    return getOAuthAccessToken(providerId, config);
  }
  const resolved = process.env[token];
  return resolved !== undefined ? resolved : `<${token}>`;
}

async function resolveSecrets(value: string): Promise<string> {
  const names = new Set<string>();
  for (const match of value.matchAll(PLACEHOLDER_RE)) names.add(match[1]);
  if (names.size === 0) return value;

  const resolved = await Promise.all([...names].map(async (name) => [name, await resolvePlaceholder(name)] as const));
  let result = value;
  for (const [name, value_] of resolved) result = result.split(`<${name}>`).join(value_);
  return result;
}

async function resolveFlatRecord(record: Record<string, string>): Promise<Record<string, string>> {
  const entries = await Promise.all(Object.entries(record).map(async ([k, v]) => [k, await resolveSecrets(v)] as const));
  return Object.fromEntries(entries);
}

async function resolveBodyValue(value: JsonValue): Promise<JsonValue> {
  if (typeof value === 'string') return resolveSecrets(value);
  if (Array.isArray(value)) return Promise.all(value.map(resolveBodyValue));
  if (value !== null && typeof value === 'object') {
    const entries = await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await resolveBodyValue(v)] as const));
    return Object.fromEntries(entries) as JsonValue;
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
    const started = performance.now();

    try {
      const headers = await resolveFlatRecord(req.headers);
      const query = await resolveFlatRecord(req.query);

      const url = new URL(req.url);
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }

      const body = req.body !== null ? await resolveBodyValue(req.body) : null;

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
