import { describe, it, expect, vi } from 'vitest';
import { HttpTransport } from '../../src/transport.js';
import { InMemoryStemCache } from '../../src/stems/in-memory-cache.js';
import { StemFetcher } from '../../src/stems/fetcher.js';
import { prefetchRiffs, type PrefetchClient } from '../../src/stems/prefetcher.js';
import type { RiffDocument } from '../../src/types/riff.js';
import type { ResolvedStem } from '../../src/types/stem.js';

function makeStem(i: number, len = 4): ResolvedStem {
  return {
    stemId: `stem-${i}`,
    format: 'flac',
    url: `https://cdn.example/stem-${i}.flac`,
    length: len,
    mime: 'audio/flac',
  };
}

function makeRiff(riffId: string, stemIds: string[]): RiffDocument {
  return {
    riffId,
    jamId: 'band-jam-1',
    creatorUserName: 'alice',
    createdAtNs: 0n,
    bps: 120,
    barLength: 4,
    root: 0,
    scale: 0,
    slots: stemIds.map((s) => ({ on: true, gain: 1, stemId: s })),
  } as unknown as RiffDocument;
}

function makeClient(opts: {
  riffs: Record<string, RiffDocument>;
  stems: Record<string, (ResolvedStem | null)[]>;
  getStemUrlsError?: Record<string, Error>;
}): PrefetchClient {
  return {
    async getRiffs(_jamId, ids) {
      return ids.map((id) => opts.riffs[id]!).filter(Boolean);
    },
    async getStemUrls(_jamId, riff) {
      if (opts.getStemUrlsError?.[riff.riffId]) {
        throw opts.getStemUrlsError[riff.riffId]!;
      }
      return opts.stems[riff.riffId] ?? [];
    },
  };
}

function makeFetcher(): { fetcher: StemFetcher; cache: InMemoryStemCache } {
  const cache = new InMemoryStemCache();
  const transport = new HttpTransport({
    fetch: vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })),
    sleep: async () => {},
  });
  const fetcher = new StemFetcher({ transport, cache });
  return { fetcher, cache };
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe('prefetchRiffs', () => {
  it('emits a progress event per riff and reports success in done()', async () => {
    const { fetcher } = makeFetcher();
    const client = makeClient({
      riffs: {
        r1: makeRiff('r1', ['stem-0', 'stem-1']),
        r2: makeRiff('r2', ['stem-2', 'stem-3']),
      },
      stems: {
        r1: [makeStem(0), makeStem(1)],
        r2: [makeStem(2), makeStem(3)],
      },
    });

    const handle = prefetchRiffs({
      client,
      fetcher,
      jamId: 'band-jam-1',
      riffIds: ['r1', 'r2'],
    });

    const progressP = collect(handle.progress);
    const result = await handle.done();
    const progress = await progressP;

    expect(progress).toHaveLength(2);
    expect(progress.map((p) => p.riffId).sort()).toEqual(['r1', 'r2']);
    for (const p of progress) {
      expect(p.total).toBe(2);
      expect(p.done).toBe(2);
      expect(p.downloaded).toBe(2);
      expect(p.cached).toBe(0);
      expect(p.failed).toBe(0);
    }

    expect(result.riffsCompleted).toBe(2);
    expect(result.riffsFailed).toBe(0);
    expect(result.cancelled).toBe(false);
  });

  it('counts pre-cached stems as cached, not downloaded', async () => {
    const { fetcher, cache } = makeFetcher();
    await cache.put({ stemId: 'stem-0', jamId: 'band-jam-1', format: 'flac' }, new Uint8Array([1, 2, 3, 4]));
    const client = makeClient({
      riffs: { r1: makeRiff('r1', ['stem-0', 'stem-1']) },
      stems: { r1: [makeStem(0), makeStem(1)] },
    });

    const handle = prefetchRiffs({ client, fetcher, jamId: 'band-jam-1', riffIds: ['r1'] });
    const progress = await collect(handle.progress);
    await handle.done();

    expect(progress[0]!.cached).toBe(1);
    expect(progress[0]!.downloaded).toBe(1);
    expect(progress[0]!.failed).toBe(0);
  });

  it('treats null slots as not-applicable (excluded from total)', async () => {
    const { fetcher } = makeFetcher();
    const client = makeClient({
      riffs: { r1: makeRiff('r1', ['stem-0']) },
      stems: { r1: [makeStem(0), null, null] }, // one resolved, two null
    });

    const handle = prefetchRiffs({ client, fetcher, jamId: 'band-jam-1', riffIds: ['r1'] });
    const progress = await collect(handle.progress);
    await handle.done();

    expect(progress[0]!.total).toBe(1);
    expect(progress[0]!.downloaded).toBe(1);
  });

  it('respects windowSize: no more than N riffs in flight at once', async () => {
    let activeRiffs = 0;
    let observedMax = 0;
    const release: Array<() => void> = [];

    const transport = new HttpTransport({
      fetch: vi.fn(async () => {
        await new Promise<void>((r) => release.push(r));
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
      }),
      sleep: async () => {},
    });
    const cache = new InMemoryStemCache();
    const fetcher = new StemFetcher({ transport, cache, concurrency: 1 });

    const client: PrefetchClient = {
      async getRiffs(_j, ids) {
        return ids.map((id) => makeRiff(id, ['s']));
      },
      async getStemUrls(_j, riff) {
        activeRiffs++;
        observedMax = Math.max(observedMax, activeRiffs);
        return [makeStem(Number(riff.riffId.slice(1)))];
      },
    };

    const ids = ['r0', 'r1', 'r2', 'r3'];
    const handle = prefetchRiffs({
      client,
      fetcher,
      jamId: 'band-jam-1',
      riffIds: ids,
      windowSize: 2,
    });

    void collect(handle.progress);
    // Let workers reach their first fetch.
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    while (release.length > 0 || activeRiffs > 0) {
      const next = release.shift();
      if (next) {
        next();
        activeRiffs--;
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    await handle.done();

    expect(observedMax).toBeLessThanOrEqual(2);
    expect(observedMax).toBe(2);
  });

  it('cancel() stops scheduling new work and done() reports cancelled=true', async () => {
    const release: Array<() => void> = [];
    const transport = new HttpTransport({
      fetch: vi.fn(async () => {
        await new Promise<void>((r) => release.push(r));
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
      }),
      sleep: async () => {},
    });
    const fetcher = new StemFetcher({ transport, cache: new InMemoryStemCache(), concurrency: 1 });
    const client = makeClient({
      riffs: {
        r1: makeRiff('r1', ['s0']),
        r2: makeRiff('r2', ['s1']),
        r3: makeRiff('r3', ['s2']),
      },
      stems: {
        r1: [makeStem(0)],
        r2: [makeStem(1)],
        r3: [makeStem(2)],
      },
    });

    const handle = prefetchRiffs({
      client,
      fetcher,
      jamId: 'band-jam-1',
      riffIds: ['r1', 'r2', 'r3'],
      windowSize: 1,
    });
    void collect(handle.progress);

    // Let r1 enter flight.
    await new Promise((r) => setTimeout(r, 0));
    handle.cancel();
    // Drain whatever is pending.
    while (release.length > 0) release.shift()!();

    const result = await handle.done();
    expect(result.cancelled).toBe(true);
    // r2 and r3 should not all complete — at least one is skipped.
    expect(result.riffsCompleted).toBeLessThan(3);
  });

  it('reports partial failure: a failing riff increments riffsFailed, others succeed', async () => {
    const { fetcher } = makeFetcher();
    const client = makeClient({
      riffs: {
        r1: makeRiff('r1', ['stem-0']),
        bad: makeRiff('bad', ['stem-1']),
        r3: makeRiff('r3', ['stem-2']),
      },
      stems: {
        r1: [makeStem(0)],
        r3: [makeStem(2)],
      },
      getStemUrlsError: { bad: new Error('synthetic') },
    });

    const handle = prefetchRiffs({
      client,
      fetcher,
      jamId: 'band-jam-1',
      riffIds: ['r1', 'bad', 'r3'],
    });
    const progress = await collect(handle.progress);
    const result = await handle.done();

    expect(result.riffsCompleted).toBe(2);
    expect(result.riffsFailed).toBe(1);
    const badEvent = progress.find((p) => p.riffId === 'bad');
    expect(badEvent?.failed).toBeGreaterThan(0);
  });
});
