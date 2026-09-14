import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOAuthTokenCache,
  getOAuthAccessToken,
  oauthRefreshEnvVarNames,
  readOAuthRefreshConfig,
} from '@/lib/exec/oauth-token';

const CONFIG = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  refreshToken: 'refresh-token',
  tokenUrl: 'https://oauth2.example.com/token',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('readOAuthRefreshConfig', () => {
  it('is null when any of the four env vars is missing', () => {
    expect(readOAuthRefreshConfig('gmail', { GMAIL_OAUTH_CLIENT_ID: 'x' })).toBeNull();
  });

  it('reads all four PROVIDER_OAUTH_* vars, uppercased', () => {
    const env = {
      GMAIL_OAUTH_CLIENT_ID: 'a',
      GMAIL_OAUTH_CLIENT_SECRET: 'b',
      GMAIL_OAUTH_REFRESH_TOKEN: 'c',
      GMAIL_OAUTH_TOKEN_URL: 'https://oauth2.googleapis.com/token',
    };
    expect(readOAuthRefreshConfig('gmail', env)).toEqual({
      clientId: 'a',
      clientSecret: 'b',
      refreshToken: 'c',
      tokenUrl: 'https://oauth2.googleapis.com/token',
    });
  });
});

describe('oauthRefreshEnvVarNames', () => {
  it('lists the four var names for a provider', () => {
    expect(oauthRefreshEnvVarNames('gmail')).toEqual([
      'GMAIL_OAUTH_CLIENT_ID',
      'GMAIL_OAUTH_CLIENT_SECRET',
      'GMAIL_OAUTH_REFRESH_TOKEN',
      'GMAIL_OAUTH_TOKEN_URL',
    ]);
  });
});

describe('getOAuthAccessToken', () => {
  beforeEach(() => {
    clearOAuthTokenCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('exchanges the refresh token for an access token via a standard grant POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'at-1', expires_in: 3600 }));
    vi.stubGlobal('fetch', fetchMock);

    const token = await getOAuthAccessToken('gmail', CONFIG);

    expect(token).toBe('at-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(CONFIG.tokenUrl);
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe(CONFIG.refreshToken);
    expect(body.get('client_id')).toBe(CONFIG.clientId);
    expect(body.get('client_secret')).toBe(CONFIG.clientSecret);
  });

  it('serves a cached token without a second fetch while still fresh', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'at-1', expires_in: 3600 }));
    vi.stubGlobal('fetch', fetchMock);

    await getOAuthAccessToken('gmail', CONFIG);
    const second = await getOAuthAccessToken('gmail', CONFIG);

    expect(second).toBe('at-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes again once the cached token is within the expiry skew window', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'at-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'at-2', expires_in: 3600 }));
    vi.stubGlobal('fetch', fetchMock);

    await getOAuthAccessToken('gmail', CONFIG);
    vi.advanceTimersByTime(3600 * 1000 - 1000); // inside the 60s skew window
    const token = await getOAuthAccessToken('gmail', CONFIG);

    expect(token).toBe('at-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws with the provider id and status on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, 400)));

    await expect(getOAuthAccessToken('gmail', CONFIG)).rejects.toThrow(/gmail.*400/s);
  });

  it('throws when the response has no access_token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ expires_in: 3600 })));

    await expect(getOAuthAccessToken('gmail', CONFIG)).rejects.toThrow(/no access_token/);
  });
});
