import { describe, it, expect, vi } from 'vitest';
import { HttpTransport, HttpError, NetworkError } from '../src/transport.js';

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function makeFetch(handler: (call: RecordedCall, attempt: number) => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: RecordedCall = { url: String(input), init: init ?? {} };
    calls.push(call);
    return handler(call, calls.length);
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

describe('HttpTransport', () => {
  it('sends Accept, Accept-Language, User-Agent, and a load-balancer cookie in LB=live01..07', async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({ ok: true }));
    const transport = new HttpTransport({
      fetch: fetchImpl,
      userAgent: 'hoppper-test/0.0',
      random: () => 0.5,
    });

    await transport.request({ url: 'https://api.endlesss.fm/auth/login', method: 'POST', body: {} });

    expect(calls).toHaveLength(1);
    const { init } = calls[0]!;
    expect(getHeader(init, 'Accept')).toBe('application/json');
    expect(getHeader(init, 'Accept-Language')).toBe('en-gb');
    expect(getHeader(init, 'User-Agent')).toBe('hoppper-test/0.0');
    const cookie = getHeader(init, 'Cookie');
    expect(cookie).toMatch(/^LB=live0[1-7]$/);
  });

  it('rotates the load-balancer cookie across the full 01..07 range', async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    const samples = [0, 0.14, 0.3, 0.5, 0.7, 0.85, 0.999];
    let i = 0;
    const transport = new HttpTransport({
      fetch: fetchImpl,
      random: () => samples[i++]!,
    });

    for (let n = 0; n < samples.length; n++) {
      await transport.request({ url: 'https://example.test/x', method: 'GET' });
    }

    const cookies = calls.map((c) => getHeader(c.init, 'Cookie'));
    expect(cookies).toEqual([
      'LB=live01',
      'LB=live01',
      'LB=live03',
      'LB=live04',
      'LB=live05',
      'LB=live06',
      'LB=live07',
    ]);
  });

  it('applies Basic auth as base64(token:password)', async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    const transport = new HttpTransport({ fetch: fetchImpl });

    await transport.request({
      url: 'https://data.endlesss.fm/some-path',
      method: 'GET',
      auth: { kind: 'basic', token: 'tok-abc', password: 'pw-xyz' },
    });

    const auth = getHeader(calls[0]!.init, 'Authorization');
    expect(auth).toBe(`Basic ${Buffer.from('tok-abc:pw-xyz').toString('base64')}`);
  });

  it("applies Bearer auth as the literal 'token:password' string (LORE's format)", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    const transport = new HttpTransport({ fetch: fetchImpl });

    await transport.request({
      url: 'https://api.endlesss.fm/api/v3/feed/shared_by/foo',
      method: 'GET',
      auth: { kind: 'bearer', token: 'tok-abc', password: 'pw-xyz' },
    });

    const auth = getHeader(calls[0]!.init, 'Authorization');
    expect(auth).toBe('Bearer tok-abc:pw-xyz');
  });

  it('serializes JSON bodies and sets Content-Type', async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    const transport = new HttpTransport({ fetch: fetchImpl });

    await transport.request({
      url: 'https://api.endlesss.fm/auth/login',
      method: 'POST',
      body: { username: 'alice', password: 'wonderland' },
    });

    expect(calls[0]!.init.method).toBe('POST');
    expect(getHeader(calls[0]!.init, 'Content-Type')).toBe('application/json');
    expect(calls[0]!.init.body).toBe(
      JSON.stringify({ username: 'alice', password: 'wonderland' }),
    );
  });

  it('returns parsed JSON for 2xx responses', async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({ hello: 'world' }));
    const transport = new HttpTransport({ fetch: fetchImpl });

    const result = await transport.request<{ hello: string }>({
      url: 'https://example.test/',
      method: 'GET',
    });

    expect(result).toEqual({ hello: 'world' });
  });

  it('throws HttpError without retry on 4xx', async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({ message: 'nope' }, 401));
    const sleep = vi.fn(async (_ms: number) => {});
    const transport = new HttpTransport({ fetch: fetchImpl, sleep });

    await expect(
      transport.request({ url: 'https://example.test/', method: 'GET' }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries 5xx responses with 250 → +150 → cap-1000 backoff and throws HttpError after maxRetries', async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({ err: 'boom' }, 503));
    const sleep = vi.fn(async (_ms: number) => {});
    const transport = new HttpTransport({
      fetch: fetchImpl,
      sleep,
      retry: { maxRetries: 3 },
    });

    await expect(
      transport.request({ url: 'https://example.test/', method: 'GET' }),
    ).rejects.toBeInstanceOf(HttpError);

    expect(calls).toHaveLength(4); // initial + 3 retries
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([250, 400, 550]);
  });

  it('retries on network errors and throws NetworkError after maxRetries', async () => {
    const { fetchImpl, calls } = makeFetch(() => {
      throw new TypeError('fetch failed');
    });
    const sleep = vi.fn(async (_ms: number) => {});
    const transport = new HttpTransport({
      fetch: fetchImpl,
      sleep,
      retry: { maxRetries: 2 },
    });

    await expect(
      transport.request({ url: 'https://example.test/', method: 'GET' }),
    ).rejects.toBeInstanceOf(NetworkError);

    expect(calls).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('caps backoff at 1000ms (default step pattern)', async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({}, 500));
    const sleep = vi.fn(async (_ms: number) => {});
    const transport = new HttpTransport({
      fetch: fetchImpl,
      sleep,
      retry: { maxRetries: 8 },
    });

    await expect(
      transport.request({ url: 'https://example.test/', method: 'GET' }),
    ).rejects.toBeInstanceOf(HttpError);

    // 250, 400, 550, 700, 850, 1000, 1000, 1000
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([250, 400, 550, 700, 850, 1000, 1000, 1000]);
  });

  it('succeeds after a transient 5xx if a later retry returns 2xx', async () => {
    const responses = [
      () => jsonResponse({}, 502),
      () => jsonResponse({ ok: true }, 200),
    ];
    const { fetchImpl, calls } = makeFetch((_call, attempt) => responses[attempt - 1]!());
    const sleep = vi.fn(async (_ms: number) => {});
    const transport = new HttpTransport({ fetch: fetchImpl, sleep });

    const result = await transport.request<{ ok: boolean }>({
      url: 'https://example.test/',
      method: 'GET',
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('calls the logger with method, url, status, and attempt', async () => {
    const log = vi.fn();
    const { fetchImpl } = makeFetch(() => jsonResponse({}));
    const transport = new HttpTransport({ fetch: fetchImpl, logger: log });

    await transport.request({ url: 'https://example.test/x', method: 'GET' });

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'https://example.test/x',
        status: 200,
        attempt: 1,
      }),
    );
  });
});
