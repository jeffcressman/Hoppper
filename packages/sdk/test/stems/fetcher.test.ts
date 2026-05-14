import { describe, it, expect, vi } from 'vitest';
import { HttpTransport } from '../../src/transport.js';
import { InMemoryStemCache } from '../../src/stems/in-memory-cache.js';
import { StemFetcher, StemIntegrityError } from '../../src/stems/fetcher.js';
import type { ResolvedStem } from '../../src/types/stem.js';

function makeTransport(handler: (url: string) => Response | Promise<Response>): HttpTransport {
  return new HttpTransport({
    fetch: vi.fn(async (input: RequestInfo | URL) => handler(String(input))),
    sleep: async () => {},
  });
}

function binaryResponse(bytes: Uint8Array, status = 200): Response {
  return new Response(bytes, { status });
}

const sampleStem: ResolvedStem = {
  stemId: 'stem-1',
  format: 'flac',
  url: 'https://cdn.example/stem-1.flac',
  length: 8,
  mime: 'audio/flac',
};

const bytes = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x00, 0x01, 0x02, 0x03]);

describe('StemFetcher.fetchOne', () => {
  it('returns the cached blob without hitting the network on cache hit', async () => {
    const cache = new InMemoryStemCache();
    await cache.put({ stemId: 'stem-1', jamId: 'band-jam', format: 'flac' }, bytes);

    const fetchImpl = vi.fn();
    const transport = new HttpTransport({ fetch: fetchImpl, sleep: async () => {} });

    const fetcher = new StemFetcher({ transport, cache });
    const blob = await fetcher.fetchOne(sampleStem, 'band-jam');

    expect(blob.source).toBe('memory');
    expect(Array.from(blob.bytes)).toEqual(Array.from(bytes));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('downloads on cache miss, stores in cache, and returns blob with source="network"', async () => {
    const cache = new InMemoryStemCache();
    const transport = makeTransport(() => binaryResponse(bytes));

    const fetcher = new StemFetcher({ transport, cache });
    const blob = await fetcher.fetchOne(sampleStem, 'band-jam');

    expect(blob.source).toBe('network');
    expect(blob.format).toBe('flac');
    expect(blob.length).toBe(bytes.length);
    expect(Array.from(blob.bytes)).toEqual(Array.from(bytes));

    // Side effect: cache now holds it.
    const cached = await cache.get('stem-1');
    expect(cached).not.toBeNull();
    expect(Array.from(cached!.bytes)).toEqual(Array.from(bytes));
  });

  it('issues the request against the resolved URL with appropriate Accept header', async () => {
    const cache = new InMemoryStemCache();
    let observedUrl = '';
    let observedAccept: string | null = null;
    const transport = new HttpTransport({
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        observedUrl = String(input);
        const h = init?.headers as Record<string, string> | undefined;
        observedAccept = h ? Object.entries(h).find(([k]) => k.toLowerCase() === 'accept')?.[1] ?? null : null;
        return binaryResponse(bytes);
      }),
      sleep: async () => {},
    });

    const fetcher = new StemFetcher({ transport, cache });
    await fetcher.fetchOne(sampleStem, 'band-jam');

    expect(observedUrl).toBe(sampleStem.url);
    expect(observedAccept).toBe('audio/flac');
  });

  it('throws StemIntegrityError when downloaded byte length differs from resolved.length', async () => {
    const cache = new InMemoryStemCache();
    const shortBytes = new Uint8Array([0x66, 0x4c, 0x61, 0x43]); // 4 bytes, resolved says 8
    const transport = makeTransport(() => binaryResponse(shortBytes));

    const fetcher = new StemFetcher({ transport, cache });
    await expect(fetcher.fetchOne(sampleStem, 'band-jam')).rejects.toBeInstanceOf(StemIntegrityError);

    // And nothing was stored.
    await expect(cache.has('stem-1')).resolves.toBe(false);
  });

  it('with allowSizeMismatch=true, logs a warning but still returns + caches the blob', async () => {
    const cache = new InMemoryStemCache();
    const shortBytes = new Uint8Array([0x66, 0x4c, 0x61, 0x43]);
    const transport = makeTransport(() => binaryResponse(shortBytes));
    const logs: unknown[] = [];

    const fetcher = new StemFetcher({
      transport,
      cache,
      allowSizeMismatch: true,
      logger: (e) => logs.push(e),
    });

    const blob = await fetcher.fetchOne(sampleStem, 'band-jam');
    expect(blob.length).toBe(4);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      kind: 'size-mismatch',
      stemId: 'stem-1',
      expected: 8,
      actual: 4,
    });
    await expect(cache.has('stem-1')).resolves.toBe(true);
  });
});
