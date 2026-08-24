/** Retry policy + rate-limit header parsing (DESIGN.md section 6). */

export const MAX_ATTEMPTS = 3;

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 4000;
const JITTER_MAX_MS = 100;

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

/**
 * `attempt` is the attempt number that was just made (1-based). Retries are
 * bounded by MAX_ATTEMPTS total attempts.
 */
export function shouldRetry(params: {
  status: number | null;
  isNetworkError: boolean;
  attempt: number;
}): boolean {
  if (params.attempt >= MAX_ATTEMPTS) return false;
  if (params.isNetworkError) return true;
  if (params.status === null) return false;
  return isRetryableStatus(params.status);
}

/**
 * Backoff before the next attempt. `retryCount` is the number of attempts
 * already made (1 before attempt 2, 2 before attempt 3, ...).
 * `backoffMs(n) = min(250 * 2 ** (n - 1), 4000)` plus deterministic jitter,
 * unless the server told us explicitly via Retry-After.
 */
export function computeBackoffMs(
  retryCount: number,
  rng: () => number,
  retryAfterSeconds?: number | null
): number {
  if (retryAfterSeconds !== undefined && retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds)) {
    return Math.max(0, Math.round(retryAfterSeconds * 1000));
  }
  const base = Math.min(BASE_BACKOFF_MS * 2 ** (retryCount - 1), MAX_BACKOFF_MS);
  const jitter = Math.floor(rng() * JITTER_MAX_MS);
  return base + jitter;
}

// --- Rate-limit header parsing ---------------------------------------------

const LIMIT_HEADER_ALIASES = ['x-ratelimit-limit', 'x-rate-limit-limit'];
const REMAINING_HEADER_ALIASES = ['x-ratelimit-remaining', 'x-rate-limit-remaining'];
const RESET_HEADER_ALIASES = ['x-ratelimit-reset', 'x-rate-limit-reset'];
const RETRY_AFTER_ALIASES = ['retry-after'];

function findHeader(headers: Record<string, string>, aliases: string[]): string | undefined {
  const lower = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    lower.set(key.toLowerCase(), value);
  }
  for (const alias of aliases) {
    const value = lower.get(alias);
    if (value !== undefined) return value;
  }
  return undefined;
}

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  resetSeconds: number | null;
  warning: string | null;
}

/** Detect rate limiting from x-ratelimit-* headers (case-insensitive, aliased) and status. */
export function parseRateLimitHeaders(headers: Record<string, string>, status: number): RateLimitInfo {
  const limitRaw = findHeader(headers, LIMIT_HEADER_ALIASES);
  const remainingRaw = findHeader(headers, REMAINING_HEADER_ALIASES);
  const resetRaw = findHeader(headers, RESET_HEADER_ALIASES);

  const limit = limitRaw !== undefined ? Number(limitRaw) : null;
  const remaining = remainingRaw !== undefined ? Number(remainingRaw) : null;
  const resetSeconds = resetRaw !== undefined ? Number(resetRaw) : null;

  let warning: string | null = null;
  if (status === 429) {
    warning = 'Rate limited (HTTP 429).';
  } else if (remaining === 0) {
    warning = 'Rate limit exhausted (0 requests remaining).';
  } else if (limit !== null && limit > 0 && remaining !== null && remaining / limit < 0.2) {
    warning = `Rate limit nearly exhausted (${remaining}/${limit} remaining).`;
  }

  return { limit, remaining, resetSeconds, warning };
}

/** Retry-After (seconds), when present, wins over the computed backoff. */
export function getRetryAfterSeconds(headers: Record<string, string>): number | null {
  const raw = findHeader(headers, RETRY_AFTER_ALIASES);
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
