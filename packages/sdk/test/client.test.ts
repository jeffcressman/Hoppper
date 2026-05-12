import { describe, it, expect, vi } from 'vitest';
import { EndlesssClient, AuthError } from '../src/client.js';
import { InMemoryTokenStore } from '../src/token-store.js';
import { HttpError } from '../src/transport.js';
import type { AuthSession } from '../src/types.js';

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;

function makeFetch(routes: Record<string, Route>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    for (const [pattern, route] of Object.entries(routes)) {
      if (url.includes(pattern)) return route(url, init ?? {});
    }
    return new Response(JSON.stringify({ message: `unrouted: ${url}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getHeader(init: RequestInit, name: string): string | null {
  const headers = init.headers;
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers as Record<string, string>)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

const validLoginBody = {
  token: 'tok-123',
  password: 'pw-456',
  user_id: 'alice',
  expires: 1_900_000_000_000,
};

describe('EndlesssClient.login', () => {
  it('POSTs username/password as JSON to /auth/login on the API domain', async () => {
    const { fetchImpl, calls } = makeFetch({ '/auth/login': () => jsonResponse(validLoginBody) });
    const client = new EndlesssClient({ fetch: fetchImpl });

    await client.login('alice', 'secret');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.endlesss.fm/auth/login');
    expect(calls[0]!.init.method).toBe('POST');
    expect(getHeader(calls[0]!.init, 'Content-Type')).toBe('application/json');
    expect(calls[0]!.init.body).toBe(JSON.stringify({ username: 'alice', password: 'secret' }));
  });

  it('parses the response into an AuthSession and persists it via the TokenStore', async () => {
    const { fetchImpl } = makeFetch({ '/auth/login': () => jsonResponse(validLoginBody) });
    const store = new InMemoryTokenStore();
    const client = new EndlesssClient({ fetch: fetchImpl, tokenStore: store });

    const session = await client.login('alice', 'secret');

    const expected: AuthSession = {
      token: 'tok-123',
      password: 'pw-456',
      userId: 'alice',
      expiresAt: 1_900_000_000_000,
    };
    expect(session).toEqual(expected);
    await expect(store.load()).resolves.toEqual(expected);
  });

  it('throws AuthError carrying the server message when the response is an auth failure', async () => {
    const { fetchImpl } = makeFetch({
      '/auth/login': () => jsonResponse({ message: 'invalid credentials' }, 401),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });

    await expect(client.login('alice', 'wrong')).rejects.toMatchObject({
      name: 'AuthError',
      message: 'invalid credentials',
    });
  });

  it('throws AuthError when a 2xx response is missing token/password (defensive)', async () => {
    const { fetchImpl } = makeFetch({
      '/auth/login': () => jsonResponse({ user_id: 'alice' }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });

    await expect(client.login('alice', 'secret')).rejects.toBeInstanceOf(AuthError);
  });
});

describe('EndlesssClient.getSession / isSessionExpired', () => {
  it('returns null before login', async () => {
    const client = new EndlesssClient({ fetch: vi.fn() });
    await expect(client.getSession()).resolves.toBeNull();
  });

  it('returns the loaded session after login', async () => {
    const { fetchImpl } = makeFetch({ '/auth/login': () => jsonResponse(validLoginBody) });
    const client = new EndlesssClient({ fetch: fetchImpl });
    const session = await client.login('alice', 'secret');
    await expect(client.getSession()).resolves.toEqual(session);
  });

  it('isSessionExpired() reports true once now > expiresAt', () => {
    const client = new EndlesssClient({ fetch: vi.fn() });
    const session: AuthSession = {
      token: 't',
      password: 'p',
      userId: 'alice',
      expiresAt: 1000,
    };
    expect(client.isSessionExpired(session, 999)).toBe(false);
    expect(client.isSessionExpired(session, 1000)).toBe(false);
    expect(client.isSessionExpired(session, 1001)).toBe(true);
    expect(client.isSessionExpired(null, 0)).toBe(true);
  });

  it('logout() clears the stored session', async () => {
    const { fetchImpl } = makeFetch({ '/auth/login': () => jsonResponse(validLoginBody) });
    const store = new InMemoryTokenStore();
    const client = new EndlesssClient({ fetch: fetchImpl, tokenStore: store });

    await client.login('alice', 'secret');
    await client.logout();

    await expect(store.load()).resolves.toBeNull();
    await expect(client.getSession()).resolves.toBeNull();
  });
});

describe('EndlesssClient.getSubscribedJams', () => {
  it('throws AuthError when called without a session', async () => {
    const client = new EndlesssClient({ fetch: vi.fn() });
    await expect(client.getSubscribedJams()).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError when the session has expired (no auto-refresh)', async () => {
    const { fetchImpl } = makeFetch({ '/auth/login': () => jsonResponse(validLoginBody) });
    const client = new EndlesssClient({
      fetch: fetchImpl,
      now: () => validLoginBody.expires + 1,
    });
    await client.login('alice', 'secret');

    await expect(client.getSubscribedJams()).rejects.toBeInstanceOf(AuthError);
  });

  it('GETs /user_appdata$<user>/_design/membership/_view/getMembership with Basic auth', async () => {
    const { fetchImpl, calls } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/_design/membership/_view/getMembership': () =>
        jsonResponse({
          total_rows: 2,
          offset: 0,
          rows: [
            { id: 'band123', key: '2025-09-01T12:00:00Z', value: null },
            { id: 'band456', key: '2025-10-01T09:30:00Z', value: null },
          ],
        }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    const jams = await client.getSubscribedJams();

    const dataCall = calls.find((c) => c.url.includes('getMembership'))!;
    expect(dataCall.url).toBe(
      'https://data.endlesss.fm/user_appdata$alice/_design/membership/_view/getMembership',
    );
    expect(dataCall.init.method).toBe('GET');
    const expectedAuth = `Basic ${Buffer.from('tok-123:pw-456').toString('base64')}`;
    expect(getHeader(dataCall.init, 'Authorization')).toBe(expectedAuth);

    expect(jams).toEqual([
      { jamId: 'band123', joinedAt: '2025-09-01T12:00:00Z' },
      { jamId: 'band456', joinedAt: '2025-10-01T09:30:00Z' },
    ]);
  });

  it('escapes hyphens in the username as (2d) for the CouchDB path', async () => {
    const loginWithHyphen = { ...validLoginBody, user_id: 'foo-bar-baz' };
    const { fetchImpl, calls } = makeFetch({
      '/auth/login': () => jsonResponse(loginWithHyphen),
      '/_design/membership/_view/getMembership': () =>
        jsonResponse({ total_rows: 0, offset: 0, rows: [] }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('foo-bar-baz', 'secret');

    await client.getSubscribedJams();

    const dataCall = calls.find((c) => c.url.includes('getMembership'))!;
    expect(dataCall.url).toContain('/user_appdata$foo(2d)bar(2d)baz/');
  });

  it('surfaces server HTTP errors as HttpError', async () => {
    const { fetchImpl } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/_design/membership/_view/getMembership': () =>
        jsonResponse({ error: 'not_found' }, 404),
    });
    const client = new EndlesssClient({
      fetch: fetchImpl,
      retry: { maxRetries: 0 },
    });
    await client.login('alice', 'secret');

    await expect(client.getSubscribedJams()).rejects.toBeInstanceOf(HttpError);
  });
});
