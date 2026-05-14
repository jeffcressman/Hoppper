import { describe, it, expect } from 'vitest';
import type { StemCouchID } from '@hoppper/sdk';
import {
  createAudioBufferCache,
  type AudioBufferLike,
} from '../../src/audio/audio-buffer-cache.js';

function fakeBuffer(opts: {
  length: number;
  channels?: number;
  sampleRate?: number;
}): AudioBufferLike {
  return {
    length: opts.length,
    numberOfChannels: opts.channels ?? 2,
    sampleRate: opts.sampleRate ?? 48000,
    duration: opts.length / (opts.sampleRate ?? 48000),
  };
}

function id(s: string): StemCouchID {
  return s as StemCouchID;
}

describe('createAudioBufferCache', () => {
  it('stores and retrieves a buffer by stem id', () => {
    const cache = createAudioBufferCache({ maxBytes: 1024 * 1024 });
    const buf = fakeBuffer({ length: 1000 });
    cache.put(id('a'), buf);
    expect(cache.has(id('a'))).toBe(true);
    expect(cache.get(id('a'))).toBe(buf);
  });

  it('returns undefined for a missing key', () => {
    const cache = createAudioBufferCache({ maxBytes: 1024 * 1024 });
    expect(cache.get(id('missing'))).toBeUndefined();
    expect(cache.has(id('missing'))).toBe(false);
  });

  it('reports approxBytes as length * channels * 4 across all entries', () => {
    const cache = createAudioBufferCache({ maxBytes: 1024 * 1024 });
    cache.put(id('a'), fakeBuffer({ length: 100, channels: 2 })); // 800
    cache.put(id('b'), fakeBuffer({ length: 200, channels: 1 })); //  800
    expect(cache.approxBytes()).toBe(800 + 800);
  });

  it('replacing the same key updates the buffer and byte total', () => {
    const cache = createAudioBufferCache({ maxBytes: 1024 * 1024 });
    cache.put(id('a'), fakeBuffer({ length: 100, channels: 2 })); // 800
    cache.put(id('a'), fakeBuffer({ length: 250, channels: 2 })); // 2000
    expect(cache.approxBytes()).toBe(2000);
    expect(cache.get(id('a'))?.length).toBe(250);
  });

  it('evicts least-recently-used entries when over cap', () => {
    // Each fakeBuffer is 800 bytes. Cap = 2000 → can hold 2, third forces eviction.
    const cache = createAudioBufferCache({ maxBytes: 2000 });
    const a = fakeBuffer({ length: 100, channels: 2 });
    const b = fakeBuffer({ length: 100, channels: 2 });
    const c = fakeBuffer({ length: 100, channels: 2 });
    cache.put(id('a'), a);
    cache.put(id('b'), b);
    cache.put(id('c'), c);
    expect(cache.has(id('a'))).toBe(false); // evicted
    expect(cache.has(id('b'))).toBe(true);
    expect(cache.has(id('c'))).toBe(true);
    expect(cache.approxBytes()).toBe(1600);
  });

  it('get bumps recency so the touched entry survives the next eviction', () => {
    const cache = createAudioBufferCache({ maxBytes: 2000 });
    cache.put(id('a'), fakeBuffer({ length: 100, channels: 2 }));
    cache.put(id('b'), fakeBuffer({ length: 100, channels: 2 }));
    // Touch 'a' so it becomes most-recent; now 'b' is LRU.
    cache.get(id('a'));
    cache.put(id('c'), fakeBuffer({ length: 100, channels: 2 }));
    expect(cache.has(id('a'))).toBe(true);
    expect(cache.has(id('b'))).toBe(false);
    expect(cache.has(id('c'))).toBe(true);
  });

  it('has does NOT bump recency (peek without touch)', () => {
    const cache = createAudioBufferCache({ maxBytes: 2000 });
    cache.put(id('a'), fakeBuffer({ length: 100, channels: 2 }));
    cache.put(id('b'), fakeBuffer({ length: 100, channels: 2 }));
    // has('a') should not promote it; 'a' is still LRU.
    cache.has(id('a'));
    cache.put(id('c'), fakeBuffer({ length: 100, channels: 2 }));
    expect(cache.has(id('a'))).toBe(false); // evicted
    expect(cache.has(id('b'))).toBe(true);
    expect(cache.has(id('c'))).toBe(true);
  });

  it('evicts multiple entries in a single put if the new buffer is large', () => {
    const cache = createAudioBufferCache({ maxBytes: 2000 });
    cache.put(id('a'), fakeBuffer({ length: 100, channels: 2 })); // 800
    cache.put(id('b'), fakeBuffer({ length: 100, channels: 2 })); // 800
    // Big buffer (1600 bytes) forces both to evict, then this fits alone.
    cache.put(id('big'), fakeBuffer({ length: 200, channels: 2 }));
    expect(cache.has(id('a'))).toBe(false);
    expect(cache.has(id('b'))).toBe(false);
    expect(cache.has(id('big'))).toBe(true);
    expect(cache.approxBytes()).toBe(1600);
  });

  it('admits a buffer larger than cap on its own (caller asked for it; eviction empties cache first)', () => {
    // Design choice: never reject a put. If a single buffer exceeds cap, we still
    // hold it — the hop engine just asked us to, and refusing breaks playback.
    const cache = createAudioBufferCache({ maxBytes: 1000 });
    cache.put(id('a'), fakeBuffer({ length: 100, channels: 2 })); // 800
    cache.put(id('huge'), fakeBuffer({ length: 500, channels: 2 })); // 4000 > cap
    expect(cache.has(id('a'))).toBe(false);
    expect(cache.has(id('huge'))).toBe(true);
    expect(cache.approxBytes()).toBe(4000);
  });

  it('uses a default cap when none is provided', () => {
    const cache = createAudioBufferCache();
    cache.put(id('a'), fakeBuffer({ length: 100, channels: 2 }));
    expect(cache.has(id('a'))).toBe(true);
    expect(cache.approxBytes()).toBe(800);
  });

  it('counts mono buffers correctly', () => {
    const cache = createAudioBufferCache({ maxBytes: 1024 * 1024 });
    cache.put(id('m'), fakeBuffer({ length: 1000, channels: 1 }));
    expect(cache.approxBytes()).toBe(4000);
  });
});
