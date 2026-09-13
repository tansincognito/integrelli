/**
 * Generic RFC 6749 refresh-token grant, provider-agnostic — no provider SDK,
 * just the standard POST-to-token-endpoint exchange. Fires only when all four
 * `<PROVIDER>_OAUTH_{CLIENT_ID,CLIENT_SECRET,REFRESH_TOKEN,TOKEN_URL}` env
 * vars are set for a given `provider_id`. capability-engine.ts falls back to
 * a capability's static `authentication.env_var_name` (a manually-supplied,
 * non-refreshing access token) when this config is absent.
 */

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export interface OAuthRefreshConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tokenUrl: string;
}

const cache = new Map<string, CachedToken>();
const EXPIRY_SKEW_MS = 60_000;
const TIMEOUT_MS = 10_000;

function envVarNames(providerId: string) {
  const prefix = providerId.toUpperCase();
  return {
    clientId: `${prefix}_OAUTH_CLIENT_ID`,
    clientSecret: `${prefix}_OAUTH_CLIENT_SECRET`,
    refreshToken: `${prefix}_OAUTH_REFRESH_TOKEN`,
    tokenUrl: `${prefix}_OAUTH_TOKEN_URL`,
  };
}

/** Names of the four env vars a refresh grant for this provider would read — for gate error messages. */
export function oauthRefreshEnvVarNames(providerId: string): string[] {
  const names = envVarNames(providerId);
  return [names.clientId, names.clientSecret, names.refreshToken, names.tokenUrl];
}

/** The refresh-grant config for `providerId`, or `null` if any of the four env vars is unset. */
export function readOAuthRefreshConfig(
  providerId: string,
  env: Partial<NodeJS.ProcessEnv> = process.env
): OAuthRefreshConfig | null {
  const names = envVarNames(providerId);
  const clientId = env[names.clientId];
  const clientSecret = env[names.clientSecret];
  const refreshToken = env[names.refreshToken];
  const tokenUrl = env[names.tokenUrl];
  if (!clientId || !clientSecret || !refreshToken || !tokenUrl) return null;
  return { clientId, clientSecret, refreshToken, tokenUrl };
}

/**
 * A valid access token for `providerId`, from cache if it has more than
 * `EXPIRY_SKEW_MS` left, otherwise freshly exchanged via the refresh-token
 * grant and cached. Throws on a failed exchange — callers should let that
 * fail the request rather than proceed unauthenticated.
 */
export async function getOAuthAccessToken(providerId: string, config: OAuthRefreshConfig): Promise<string> {
  const cached = cache.get(providerId);
  if (cached && cached.expiresAt - EXPIRY_SKEW_MS > Date.now()) {
    return cached.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: config.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OAuth2 token refresh failed for "${providerId}": HTTP ${response.status}${text ? ` ${text}` : ''}`);
  }

  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error(`OAuth2 token refresh for "${providerId}" returned no access_token.`);
  }

  const token: CachedToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  cache.set(providerId, token);
  return token.accessToken;
}

/** Test-only: clear the in-memory token cache between test cases. */
export function clearOAuthTokenCache(): void {
  cache.clear();
}
