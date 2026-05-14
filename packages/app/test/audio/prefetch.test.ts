import { describe, it, expect, vi } from 'vitest';
import type {
  JamCouchID,
  ResolvedStem,
  RiffCouchID,
  RiffDocument,
  StemCouchID,
} from '@hoppper/sdk';
import { createPrefetchRing, type RiffWindowItem } from '../../src/audio/prefetch.js';
import type { StemLoader } from '../../src/audio/stem-loader.js';
import type { AudioBufferLike } from '../../src/audio/audio-buffer-cache.js';

const JAM = 'band-x' as JamCouchID;

function stem(id: string): ResolvedStem {
  return {
    stemId: id as StemCouchID,
    format: 'ogg',
    url: '',
    length: 0,
    mime: 'audio/ogg',
  };
}

function riff(id: string): RiffDocument {
  return {
    riffId: id as RiffCouchID,
    jamId: JAM,
    userName: 'u',
    createdAt: 0,
    bps: 2,
    bpm: 120,
    barLength: 16,
    root: 0,
    scale: 0,
    slots: [],
  };
}

function item(riffId: string, stemIds: string[]): RiffWindowItem {
  return { riff: riff(riffId), stems: stemIds.map(stem) };
}

function deferredLoader(): StemLoader & {
  loads: { stemId: StemCouchID; settle: () => void }[];
  buffers: Map<StemCouchID, AudioBufferLike>;
} {
  const loads: { stemId: StemCouchID; settle: () => void }[] = [];
  const buffers = new Map<StemCouchID, AudioBufferLike>();
  return {
    loads,
    buffers,
    peek: vi.fn((id: StemCouchID) => buffers.get(id)),
    load: vi.fn((s: ResolvedStem) => {
      return new Promise<AudioBufferLike>((resolve) => {
        const settle = () => {
          const buf: AudioBufferLike = {
            length: 100,
            numberOfChannels: 2,
            sampleRate: 48000,
            duration: 0.002,
          };
          buffers.set(s.stemId, buf);
          resolve(buf);
        };
        loads.push({ stemId: s.stemId, settle });
      });
    }),
  } as StemLoader & {
    loads: { stemId: StemCouchID; settle: () => void }[];
    buffers: Map<StemCouchID, AudioBufferLike>;
  };
}

describe('createPrefetchRing', () => {
  it('loads each stem of each item in the window', async () => {
    const loader = deferredLoader();
    const ring = createPrefetchRing({ loader });

    ring.setWindow(JAM, [item('r1', ['a', 'b']), item('r2', ['c'])]);
    // Wait for the microtask queue to flush so the first load() is invoked.
    await Promise.resolve();
    await Promise.resolve();

    expect(loader.load).toHaveBeenCalledTimes(1);
    expect(loader.loads[0]?.stemId).toBe('a');
    loader.loads[0]!.settle();
    await Promise.resolve();
    await Promise.resolve();

    expect(loader.loads[1]?.stemId).toBe('b');
    loader.loads[1]!.settle();
    await Promise.resolve();
    await Promise.resolve();

    expect(loader.loads[2]?.stemId).toBe('c');
    loader.loads[2]!.settle();
    await Promise.resolve();

    expect(loader.load).toHaveBeenCalledTimes(3);
  });

  it('a new setWindow cancels any further loads from the old window', async () => {
    const loader = deferredLoader();
    const ring = createPrefetchRing({ loader });

    ring.setWindow(JAM, [item('r1', ['a', 'b']), item('r2', ['c'])]);
    await Promise.resolve();
    await Promise.resolve();

    // First load is in-flight (settled below); window moves before its peers are touched.
    expect(loader.loads.length).toBe(1);
    ring.setWindow(JAM, [item('r9', ['z'])]);

    // Settle the in-flight one — the next 'b' load must NOT be requested.
    loader.loads[0]!.settle();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // 'a' was already in-flight when we cancelled; 'b' and 'c' must never run.
    const stemIds = loader.loads.map((l) => l.stemId);
    expect(stemIds).toContain('a');
    expect(stemIds).toContain('z'); // new window started
    expect(stemIds).not.toContain('b');
    expect(stemIds).not.toContain('c');
  });

  it('cancel() halts all further prefetch work', async () => {
    const loader = deferredLoader();
    const ring = createPrefetchRing({ loader });

    ring.setWindow(JAM, [item('r1', ['a', 'b', 'c'])]);
    await Promise.resolve();
    await Promise.resolve();
    expect(loader.loads.length).toBe(1);

    ring.cancel();
    loader.loads[0]!.settle();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // No further loads after cancel.
    expect(loader.loads.length).toBe(1);
  });

  it('continues across riff boundaries within the same window', async () => {
    const loader = deferredLoader();
    const ring = createPrefetchRing({ loader });

    ring.setWindow(JAM, [item('r1', ['a']), item('r2', ['b']), item('r3', ['c'])]);
    for (let i = 0; i < 6; i++) {
      // Settle whatever is in flight, then yield twice.
      await Promise.resolve();
      await Promise.resolve();
      const next = loader.loads[i];
      if (next) next.settle();
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(loader.load).toHaveBeenCalledTimes(3);
    expect(loader.loads.map((l) => l.stemId)).toEqual(['a', 'b', 'c']);
  });

  it('swallows loader errors so one bad stem does not stop the window', async () => {
    const loader = deferredLoader();
    // Replace .load: first call rejects, second resolves.
    let call = 0;
    loader.load = vi.fn((s: ResolvedStem) => {
      call++;
      if (call === 1) return Promise.reject(new Error('decode boom'));
      return Promise.resolve<AudioBufferLike>({
        length: 1,
        numberOfChannels: 1,
        sampleRate: 48000,
        duration: 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ _id: s.stemId } as any),
      });
    });
    const ring = createPrefetchRing({ loader });

    ring.setWindow(JAM, [item('r1', ['a', 'b'])]);
    for (let i = 0; i < 6; i++) await Promise.resolve();

    expect(loader.load).toHaveBeenCalledTimes(2);
  });
});
