import { describe, it, expect, vi } from 'vitest';
import { EndlesssClient, AuthError } from '../src/client.js';
import { InMemoryTokenStore } from '../src/token-store.js';
import { HttpError } from '../src/transport.js';
import type { AuthSession } from '../src/types/index.js';

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

describe('EndlesssClient.getJam', () => {
  it('throws AuthError when called without a session', async () => {
    const client = new EndlesssClient({ fetch: vi.fn() });
    await expect(client.getJam('band123')).rejects.toBeInstanceOf(AuthError);
  });

  it('GETs /user_appdata$<jamId>/Profile and maps app_version → appVersion', async () => {
    const { fetchImpl, calls } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/Profile': () =>
        jsonResponse({ displayName: 'Jazz Lab', app_version: 1234, bio: 'late-night noodling' }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    const jam = await client.getJam('band9e1b8a260f');

    const dataCall = calls.find((c) => c.url.includes('/Profile'))!;
    expect(dataCall.url).toBe('https://data.endlesss.fm/user_appdata$band9e1b8a260f/Profile');
    expect(getHeader(dataCall.init, 'Authorization')).toBe(
      `Basic ${Buffer.from('tok-123:pw-456').toString('base64')}`,
    );

    expect(jam).toEqual({
      jamId: 'band9e1b8a260f',
      displayName: 'Jazz Lab',
      bio: 'late-night noodling',
      appVersion: 1234,
    });
  });

  it('escapes hyphens in a personal jam ID (username-derived) as (2d)', async () => {
    const { fetchImpl, calls } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/Profile': () => jsonResponse({ displayName: "Foo's Solo Jam" }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    await client.getJam('foo-bar-baz');

    const dataCall = calls.find((c) => c.url.includes('/Profile'))!;
    expect(dataCall.url).toBe(
      'https://data.endlesss.fm/user_appdata$foo(2d)bar(2d)baz/Profile',
    );
  });

  it('does not escape hyphens for band-prefixed jam IDs', async () => {
    const { fetchImpl, calls } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/Profile': () => jsonResponse({ displayName: 'X' }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    await client.getJam('band-this-should-not-happen-but-test-it');

    const dataCall = calls.find((c) => c.url.includes('/Profile'))!;
    expect(dataCall.url).toContain('band-this-should-not-happen-but-test-it');
    expect(dataCall.url).not.toContain('(2d)');
  });

  it('omits bio / appVersion when absent in the response', async () => {
    const { fetchImpl } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/Profile': () => jsonResponse({ displayName: 'Bare Profile' }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    const jam = await client.getJam('band123');
    expect(jam).toEqual({ jamId: 'band123', displayName: 'Bare Profile' });
  });
});

describe('EndlesssClient.listJams', () => {
  it('throws AuthError when called without a session', async () => {
    const client = new EndlesssClient({ fetch: vi.fn() });
    await expect(client.listJams()).rejects.toBeInstanceOf(AuthError);
  });

  it('returns personal, subscribed, and joinable categories by default', async () => {
    const { fetchImpl } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/_design/membership/_view/getMembership': () =>
        jsonResponse({
          total_rows: 2,
          offset: 0,
          rows: [
            { id: 'band-aaa', key: '2025-09-01T12:00:00Z', value: null },
            { id: 'band-bbb', key: '2025-10-01T09:30:00Z', value: null },
          ],
        }),
      '/app_client_config/bands:joinable': () =>
        jsonResponse({ band_ids: ['band-public-1', 'band-public-2'] }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    const listing = await client.listJams();

    expect(listing.personal).toEqual({ jamId: 'alice', category: 'personal' });
    expect(listing.subscribed).toEqual([
      { jamId: 'band-aaa', category: 'subscribed', joinedAt: '2025-09-01T12:00:00Z' },
      { jamId: 'band-bbb', category: 'subscribed', joinedAt: '2025-10-01T09:30:00Z' },
    ]);
    expect(listing.joinable).toEqual([
      { jamId: 'band-public-1', category: 'joinable' },
      { jamId: 'band-public-2', category: 'joinable' },
    ]);
  });

  it('skips the joinable request when includeJoinable is false', async () => {
    const { fetchImpl, calls } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/_design/membership/_view/getMembership': () =>
        jsonResponse({ total_rows: 0, offset: 0, rows: [] }),
      '/app_client_config/bands:joinable': () => {
        throw new Error('joinable should not be requested');
      },
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    const listing = await client.listJams({ includeJoinable: false });

    expect(listing.joinable).toEqual([]);
    expect(calls.find((c) => c.url.includes('bands:joinable'))).toBeUndefined();
  });

  it('sends Basic auth on the joinable endpoint', async () => {
    const { fetchImpl, calls } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/_design/membership/_view/getMembership': () =>
        jsonResponse({ total_rows: 0, offset: 0, rows: [] }),
      '/app_client_config/bands:joinable': () => jsonResponse({ band_ids: [] }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    await client.listJams();

    const call = calls.find((c) => c.url.includes('bands:joinable'))!;
    expect(call.url).toBe('https://data.endlesss.fm/app_client_config/bands:joinable');
    expect(getHeader(call.init, 'Authorization')).toBe(
      `Basic ${Buffer.from('tok-123:pw-456').toString('base64')}`,
    );
  });
});

describe('EndlesssClient.getRiffIds', () => {
  it('GETs rifffLoopsByCreateTime with descending=true by default', async () => {
    const { fetchImpl, calls } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/rifffLoopsByCreateTime': () =>
        jsonResponse({
          total_rows: 3,
          offset: 0,
          rows: [
            {
              id: 'riff-a',
              key: 1_700_000_000_000_000_000,
              value: ['stemA1', '', 'stemA3', '', '', '', '', ''],
            },
          ],
        }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    const index = await client.getRiffIds('band-jam-1');

    const call = calls.find((c) => c.url.includes('rifffLoopsByCreateTime'))!;
    expect(call.url).toBe(
      'https://data.endlesss.fm/user_appdata$band-jam-1/_design/types/_view/rifffLoopsByCreateTime?descending=true',
    );
    expect(index.totalRows).toBe(3);
    expect(index.rows[0]!.riffId).toBe('riff-a');
    expect(index.rows[0]!.createdAtNs).toBe(1_700_000_000_000_000_000n);
    expect(index.rows[0]!.stemIds).toEqual([
      'stemA1',
      null,
      'stemA3',
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('passes limit and skip query params when given', async () => {
    const { fetchImpl, calls } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/rifffLoopsByCreateTime': () =>
        jsonResponse({ total_rows: 0, offset: 0, rows: [] }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    await client.getRiffIds('band-jam-1', { limit: 25, skip: 50 });

    const call = calls.find((c) => c.url.includes('rifffLoopsByCreateTime'))!;
    expect(call.url).toContain('limit=25');
    expect(call.url).toContain('skip=50');
    expect(call.url).toContain('descending=true');
  });

  it('respects descending=false', async () => {
    const { fetchImpl, calls } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/rifffLoopsByCreateTime': () =>
        jsonResponse({ total_rows: 0, offset: 0, rows: [] }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    await client.getRiffIds('band-jam-1', { descending: false });

    const call = calls.find((c) => c.url.includes('rifffLoopsByCreateTime'))!;
    expect(call.url).not.toContain('descending=true');
  });

  it('pads stemIds arrays shorter than 8 with nulls', async () => {
    const { fetchImpl } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/rifffLoopsByCreateTime': () =>
        jsonResponse({
          total_rows: 1,
          offset: 0,
          rows: [{ id: 'r', key: 1, value: ['a', 'b', 'c', 'd'] }],
        }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    const index = await client.getRiffIds('band-jam-1');
    expect(index.rows[0]!.stemIds).toHaveLength(8);
    expect(index.rows[0]!.stemIds.slice(4)).toEqual([null, null, null, null]);
  });
});

describe('EndlesssClient.getRiffs', () => {
  function rawRiffDoc(id: string, opts?: { active?: number[] }) {
    const slots = Array.from({ length: 8 }, (_, i) => ({
      slot: {
        current: {
          on: opts?.active?.includes(i) ?? false,
          currentLoop: opts?.active?.includes(i) ? `stem-${id}-${i}` : '',
          gain: opts?.active?.includes(i) ? 0.75 : 0,
        },
      },
    }));
    return {
      _id: id,
      state: { bps: 2.0, barLength: 4, playback: slots },
      userName: 'alice',
      created: 1_700_000_000_000,
      root: 0,
      scale: 5,
      app_version: 1234,
      magnitude: 0.5,
    };
  }

  it('POSTs _all_docs with the riff IDs and returns parsed RiffDocuments aligned to input order', async () => {
    const { fetchImpl, calls } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/_all_docs': () =>
        jsonResponse({
          total_rows: 2,
          offset: 0,
          rows: [
            { id: 'riff-1', key: 'riff-1', value: { rev: 'r1' }, doc: rawRiffDoc('riff-1', { active: [0, 2] }) },
            { id: 'riff-2', key: 'riff-2', value: { rev: 'r2' }, doc: rawRiffDoc('riff-2', { active: [3] }) },
          ],
        }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    const riffs = await client.getRiffs('band-jam-1', ['riff-1', 'riff-2']);

    const call = calls.find((c) => c.url.includes('_all_docs'))!;
    expect(call.url).toBe(
      'https://data.endlesss.fm/user_appdata$band-jam-1/_all_docs?include_docs=true',
    );
    expect(call.init.method).toBe('POST');
    expect(call.init.body).toBe(JSON.stringify({ keys: ['riff-1', 'riff-2'] }));

    expect(riffs).toHaveLength(2);
    expect(riffs[0]!.riffId).toBe('riff-1');
    expect(riffs[0]!.jamId).toBe('band-jam-1');
    expect(riffs[0]!.bps).toBe(2.0);
    expect(riffs[0]!.bpm).toBeCloseTo(120, 2);
    expect(riffs[0]!.slots).toHaveLength(8);
    expect(riffs[0]!.slots[0]).toEqual({ on: true, stemId: 'stem-riff-1-0', gain: 0.75 });
    expect(riffs[0]!.slots[1]).toEqual({ on: false, stemId: null, gain: 0 });
    expect(riffs[0]!.slots[2]).toEqual({ on: true, stemId: 'stem-riff-1-2', gain: 0.75 });
    expect(riffs[1]!.slots[3]).toEqual({ on: true, stemId: 'stem-riff-2-3', gain: 0.75 });
  });

  it('handles 0/1 for "on" (quirk #2)', async () => {
    const doc = {
      _id: 'r',
      state: {
        bps: 2,
        barLength: 4,
        playback: [
          { slot: { current: { on: 1, currentLoop: 'stemX', gain: 0.5 } } },
          { slot: { current: { on: 0, currentLoop: '', gain: 0 } } },
        ],
      },
      userName: 'u',
      created: 0,
      root: 0,
      scale: 0,
    };
    const { fetchImpl } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/_all_docs': () =>
        jsonResponse({ rows: [{ id: 'r', key: 'r', value: { rev: 'x' }, doc }] }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    const [riff] = await client.getRiffs('band-jam', ['r']);
    expect(riff!.slots[0]).toEqual({ on: true, stemId: 'stemX', gain: 0.5 });
    expect(riff!.slots[1]).toEqual({ on: false, stemId: null, gain: 0 });
  });

  it('forces on=false when currentLoop is empty even if "on":true (quirk #3)', async () => {
    const doc = {
      _id: 'r',
      state: {
        bps: 2,
        barLength: 4,
        playback: [{ slot: { current: { on: true, currentLoop: '', gain: 0.5 } } }],
      },
      userName: 'u',
      created: 0,
      root: 0,
      scale: 0,
    };
    const { fetchImpl } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/_all_docs': () =>
        jsonResponse({ rows: [{ id: 'r', key: 'r', value: { rev: 'x' }, doc }] }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    const [riff] = await client.getRiffs('band-jam', ['r']);
    expect(riff!.slots[0]).toEqual({ on: false, stemId: null, gain: 0.5 });
  });

  it('skips deleted and error rows', async () => {
    const { fetchImpl } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/_all_docs': () =>
        jsonResponse({
          rows: [
            { id: 'riff-1', key: 'riff-1', value: { rev: 'r1' }, doc: rawRiffDoc('riff-1') },
            { id: 'deleted', key: 'deleted', value: { rev: 'd', deleted: true }, doc: null },
            { key: 'missing', error: 'not_found' },
            { id: 'riff-3', key: 'riff-3', value: { rev: 'r3' }, doc: rawRiffDoc('riff-3') },
          ],
        }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    const riffs = await client.getRiffs('band-jam-1', [
      'riff-1',
      'deleted',
      'missing',
      'riff-3',
    ]);

    expect(riffs.map((r) => r.riffId)).toEqual(['riff-1', 'riff-3']);
  });

  it('returns [] for an empty input', async () => {
    const client = new EndlesssClient({
      fetch: (async () => {
        throw new Error('should not fetch');
      }) as unknown as typeof fetch,
    });
    // No login required — empty input short-circuits.
    const result = await client.getRiffs('band-jam', []);
    expect(result).toEqual([]);
  });

  it('iterateRiffs yields pages and stops on a short last page', async () => {
    function rawDoc(id: string) {
      return rawRiffDoc(id);
    }
    // Simulate a 5-riff jam, pageSize 2 → pages of 2, 2, 1
    const allRows = [
      { id: 'r1', key: 5, value: [] },
      { id: 'r2', key: 4, value: [] },
      { id: 'r3', key: 3, value: [] },
      { id: 'r4', key: 2, value: [] },
      { id: 'r5', key: 1, value: [] },
    ];
    const { fetchImpl, calls } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/rifffLoopsByCreateTime': (url) => {
        const u = new URL(url);
        const limit = Number(u.searchParams.get('limit'));
        const skip = Number(u.searchParams.get('skip') ?? 0);
        const slice = allRows.slice(skip, skip + limit);
        return jsonResponse({ total_rows: allRows.length, offset: skip, rows: slice });
      },
      '/_all_docs': async (_url, init) => {
        const body = JSON.parse(init.body as string) as { keys: string[] };
        return jsonResponse({
          rows: body.keys.map((id) => ({
            id,
            key: id,
            value: { rev: 'x' },
            doc: rawDoc(id),
          })),
        });
      },
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    const pages: string[][] = [];
    for await (const page of client.iterateRiffs('band-jam-1', { pageSize: 2 })) {
      pages.push(page.map((r) => r.riffId));
    }
    expect(pages).toEqual([['r1', 'r2'], ['r3', 'r4'], ['r5']]);

    // 3 view fetches + 3 all_docs fetches + login
    const viewCalls = calls.filter((c) => c.url.includes('rifffLoopsByCreateTime'));
    expect(viewCalls).toHaveLength(3);
  });

  it('iterateRiffs yields nothing for an empty jam', async () => {
    const { fetchImpl } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/rifffLoopsByCreateTime': () =>
        jsonResponse({ total_rows: 0, offset: 0, rows: [] }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    const pages: unknown[] = [];
    for await (const page of client.iterateRiffs('band-jam-1', { pageSize: 10 })) {
      pages.push(page);
    }
    expect(pages).toEqual([]);
  });

  it('iterateRiffs passes descending=false through to the view', async () => {
    const { fetchImpl, calls } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/rifffLoopsByCreateTime': () =>
        jsonResponse({ total_rows: 0, offset: 0, rows: [] }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _page of client.iterateRiffs('band-jam-1', {
      pageSize: 5,
      descending: false,
    })) {
      // empty
    }
    const viewCall = calls.find((c) => c.url.includes('rifffLoopsByCreateTime'))!;
    expect(viewCall.url).not.toContain('descending=true');
  });

  it('getStemDocuments POSTs _all_docs and aligns results with input order', async () => {
    function rawStem(id: string, length: number) {
      return {
        _id: id,
        bps: 2,
        length16ths: 16,
        originalPitch: 0,
        barLength: 4,
        presetName: 'p',
        creatorUserName: 'alice',
        primaryColour: 'ff000000',
        sampleRate: 44100,
        created: 0,
        cdn_attachments: {
          oggAudio: {
            endpoint: 'cdn.example',
            key: `attachments/oggAudio/${id}`,
            url: `https://cdn.example/attachments/oggAudio/${id}`,
            length,
            mime: 'audio/ogg',
          },
        },
      };
    }
    const { fetchImpl, calls } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/_all_docs': async (_url, init) => {
        const body = JSON.parse(init.body as string) as { keys: string[] };
        return jsonResponse({
          rows: body.keys.map((id) => {
            if (id === 'deleted') {
              return { id, key: id, value: { rev: 'x', deleted: true }, doc: null };
            }
            if (id === 'missing') {
              return { key: id, error: 'not_found' };
            }
            return { id, key: id, value: { rev: 'x' }, doc: rawStem(id, 100) };
          }),
        });
      },
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    const stems = await client.getStemDocuments('band-jam-1', [
      'stem-a',
      'deleted',
      'missing',
      'stem-b',
    ]);

    expect(stems).toHaveLength(4);
    expect(stems[0]!.stemId).toBe('stem-a');
    expect(stems[1]).toBeNull();
    expect(stems[2]).toBeNull();
    expect(stems[3]!.stemId).toBe('stem-b');

    const call = calls.find((c) => c.url.includes('_all_docs'))!;
    expect(call.url).toContain('/user_appdata$band-jam-1/_all_docs?include_docs=true');
    expect(call.init.body).toBe(JSON.stringify({ keys: ['stem-a', 'deleted', 'missing', 'stem-b'] }));
  });

  it('getStemDocuments applies the length-as-string quirk before parsing', async () => {
    const rawBodyWithQuirk = JSON.stringify({
      rows: [
        {
          id: 'stemQ',
          key: 'stemQ',
          value: { rev: 'x' },
          doc: {
            _id: 'stemQ',
            bps: 2,
            length16ths: 16,
            originalPitch: 0,
            barLength: 4,
            presetName: 'p',
            creatorUserName: 'alice',
            primaryColour: 'ff000000',
            sampleRate: 44100,
            created: 0,
            cdn_attachments: {
              oggAudio: {
                endpoint: 'cdn.example',
                key: 'attachments/oggAudio/stemQ',
                url: 'https://cdn.example/attachments/oggAudio/stemQ',
                length: 42,
                mime: 'audio/ogg',
              },
            },
          },
        },
      ],
    }).replace('"length":42', '"length":"42"');
    expect(rawBodyWithQuirk).toContain('"length":"42"');

    const { fetchImpl } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/_all_docs': () =>
        new Response(rawBodyWithQuirk, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    const [stem] = await client.getStemDocuments('band-jam-1', ['stemQ']);
    expect(stem!.ogg?.length).toBe(42);
  });

  it('getStemUrls returns a length-8 array with nulls for off slots', async () => {
    function activeRiff(active: number[]) {
      const slots = Array.from({ length: 8 }, (_, i) => ({
        slot: {
          current: {
            on: active.includes(i),
            currentLoop: active.includes(i) ? `stem-${i}` : '',
            gain: active.includes(i) ? 1 : 0,
          },
        },
      }));
      return {
        _id: 'r',
        state: { bps: 2, barLength: 4, playback: slots },
        userName: 'u',
        created: 0,
        root: 0,
        scale: 0,
      };
    }
    function rawStem(id: string) {
      return {
        _id: id,
        bps: 2,
        length16ths: 16,
        originalPitch: 0,
        barLength: 4,
        presetName: 'p',
        creatorUserName: 'alice',
        primaryColour: 'ff000000',
        sampleRate: 44100,
        created: 0,
        cdn_attachments: {
          flacAudio: {
            endpoint: 'flac.example',
            key: `flac/${id}`,
            url: `https://flac.example/flac/${id}`,
            length: 5000,
          },
        },
      };
    }
    const { fetchImpl, calls } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/_all_docs': async (url, init) => {
        const body = JSON.parse(init.body as string) as { keys: string[] };
        // First call: riffs. Second: stems. Distinguish via key shape.
        if (body.keys.includes('riff-1')) {
          return jsonResponse({
            rows: body.keys.map((id) => ({
              id,
              key: id,
              value: { rev: 'x' },
              doc: activeRiff([0, 3, 7]),
            })),
          });
        }
        return jsonResponse({
          rows: body.keys.map((id) => ({
            id,
            key: id,
            value: { rev: 'x' },
            doc: rawStem(id),
          })),
        });
      },
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    const [riff] = await client.getRiffs('band-jam-1', ['riff-1']);
    const resolved = await client.getStemUrls('band-jam-1', riff!);

    expect(resolved).toHaveLength(8);
    expect(resolved[0]?.format).toBe('flac');
    expect(resolved[0]?.url).toBe('https://flac.example/flac/stem-0');
    expect(resolved[1]).toBeNull();
    expect(resolved[2]).toBeNull();
    expect(resolved[3]?.url).toBe('https://flac.example/flac/stem-3');
    expect(resolved[7]?.url).toBe('https://flac.example/flac/stem-7');

    // Only one stems batch request, three IDs
    const stemCalls = calls.filter(
      (c) =>
        c.url.includes('_all_docs') &&
        JSON.parse((c.init.body as string) ?? '{}').keys.every((k: string) => k.startsWith('stem-')),
    );
    expect(stemCalls).toHaveLength(1);
    const batched = JSON.parse(stemCalls[0]!.init.body as string) as { keys: string[] };
    expect(batched.keys).toEqual(['stem-0', 'stem-3', 'stem-7']);
  });

  it('getStemUrls makes no network call when all slots are off', async () => {
    const allOffRiff = {
      riffId: 'r',
      jamId: 'band-jam',
      userName: 'u',
      createdAt: 0,
      bps: 2,
      bpm: 120,
      barLength: 4,
      root: 0,
      scale: 0,
      slots: Array.from({ length: 8 }, () => ({ on: false, stemId: null, gain: 0 })),
    };
    const client = new EndlesssClient({
      fetch: (async () => {
        throw new Error('should not fetch');
      }) as unknown as typeof fetch,
    });
    const resolved = await client.getStemUrls('band-jam', allOffRiff);
    expect(resolved).toEqual(Array.from({ length: 8 }, () => null));
  });

  it('pads playback arrays shorter than 8 slots', async () => {
    const doc = {
      _id: 'r',
      state: {
        bps: 2,
        barLength: 4,
        playback: [
          { slot: { current: { on: true, currentLoop: 's0', gain: 1 } } },
          { slot: { current: { on: true, currentLoop: 's1', gain: 1 } } },
        ],
      },
      userName: 'u',
      created: 0,
      root: 0,
      scale: 0,
    };
    const { fetchImpl } = makeFetch({
      '/auth/login': () => jsonResponse(validLoginBody),
      '/_all_docs': () =>
        jsonResponse({ rows: [{ id: 'r', key: 'r', value: { rev: 'x' }, doc }] }),
    });
    const client = new EndlesssClient({ fetch: fetchImpl });
    await client.login('alice', 'secret');

    const [riff] = await client.getRiffs('band-jam', ['r']);
    expect(riff!.slots).toHaveLength(8);
    expect(riff!.slots.slice(2)).toEqual(
      Array.from({ length: 6 }, () => ({ on: false, stemId: null, gain: 0 })),
    );
  });
});
