import { describe, it, expect, vi } from 'vitest';
import type {
  JamCouchID,
  ResolvedStem,
  StemCouchID,
  StemFormat,
} from '@hoppper/sdk';
import { createStemLoader } from '../../src/audio/stem-loader.js';
import {
  createAudioBufferCache,
  type AudioBufferLike,
} from '../../src/audio/audio-buffer-cache.js';
import type { Decoder } from '../../src/audio/decoder.js';
import type { ByteSource } from '../../src/audio/stem-loader.js';

const JAM = 'band-test' as JamCouchID;

function resolved(stemId: string, format: StemFormat = 'ogg'): ResolvedStem {
  return {
    stemId: stemId as StemCouchID,
    format,
    url: `https://cdn.example/${stemId}.${format}`,
    length: 4,
    mime: format === 'ogg' ? 'audio/ogg' : 'audio/flac',
  };
}

function fakeBuffer(): AudioBufferLike {
  return { length: 100, numberOfChannels: 2, sampleRate: 48000, duration: 0.002 };
}

function byteSource(payload: Uint8Array = new Uint8Array([1, 2, 3, 4])): ByteSource & {
  calls: { stemId: StemCouchID; jamId: JamCouchID }[];
} {
  const calls: { stemId: StemCouchID; jamId: JamCouchID }[] = [];
  return {
    calls,
    fetch: vi.fn(async (stem: ResolvedStem, jamId: JamCouchID) => {
      calls.push({ stemId: stem.stemId, jamId });
      return payload;
    }),
  } as unknown as ByteSource & {
    calls: { stemId: StemCouchID; jamId: JamCouchID }[];
  };
}

function decoder(buf: AudioBufferLike = fakeBuffer()): Decoder & {
  decode: ReturnType<typeof vi.fn>;
} {
  return { decode: vi.fn().mockResolvedValue(buf) } as unknown as Decoder & {
    decode: ReturnType<typeof vi.fn>;
  };
}

describe('createStemLoader', () => {
  it('on miss: fetches bytes, decodes, stores in buffer cache, returns buffer', async () => {
    const cache = createAudioBufferCache({ maxBytes: 1 << 20 });
    const src = byteSource();
    const dec = decoder();
    const loader = createStemLoader({ source: src, decoder: dec, cache });

    const stem = resolved('s1', 'ogg');
    const buf = await loader.load(stem, JAM);

    expect(src.fetch).toHaveBeenCalledTimes(1);
    expect(dec.decode).toHaveBeenCalledTimes(1);
    expect(cache.has(stem.stemId)).toBe(true);
    expect(cache.get(stem.stemId)).toBe(buf);
  });

  it('on hit: returns cached buffer without fetching or decoding', async () => {
    const cache = createAudioBufferCache({ maxBytes: 1 << 20 });
    const stem = resolved('s1');
    const preloaded = fakeBuffer();
    cache.put(stem.stemId, preloaded);

    const src = byteSource();
    const dec = decoder();
    const loader = createStemLoader({ source: src, decoder: dec, cache });

    const buf = await loader.load(stem, JAM);
    expect(buf).toBe(preloaded);
    expect(src.fetch).not.toHaveBeenCalled();
    expect(dec.decode).not.toHaveBeenCalled();
  });

  it('coalesces concurrent loads of the same stem (single decode)', async () => {
    const cache = createAudioBufferCache({ maxBytes: 1 << 20 });
    const stem = resolved('s1', 'flac');

    let releaseDecode: (b: AudioBufferLike) => void = () => {};
    const decodePromise = new Promise<AudioBufferLike>((res) => {
      releaseDecode = res;
    });

    const src = byteSource();
    const dec = {
      decode: vi.fn().mockReturnValue(decodePromise),
    } as unknown as Decoder & { decode: ReturnType<typeof vi.fn> };
    const loader = createStemLoader({ source: src, decoder: dec, cache });

    const p1 = loader.load(stem, JAM);
    const p2 = loader.load(stem, JAM);
    const p3 = loader.load(stem, JAM);

    const buf = fakeBuffer();
    releaseDecode(buf);

    const [b1, b2, b3] = await Promise.all([p1, p2, p3]);
    expect(b1).toBe(buf);
    expect(b2).toBe(buf);
    expect(b3).toBe(buf);
    expect(src.fetch).toHaveBeenCalledTimes(1);
    expect(dec.decode).toHaveBeenCalledTimes(1);
  });

  it('after a decode completes, the in-flight slot is cleared so cache becomes authoritative', async () => {
    const cache = createAudioBufferCache({ maxBytes: 1 << 20 });
    const stem = resolved('s1');
    const src = byteSource();
    const buf1 = fakeBuffer();
    const dec = {
      decode: vi.fn().mockResolvedValue(buf1),
    } as unknown as Decoder & { decode: ReturnType<typeof vi.fn> };
    const loader = createStemLoader({ source: src, decoder: dec, cache });

    await loader.load(stem, JAM);

    // Manually evict to force a fresh fetch+decode on the next load.
    cache.put('other' as StemCouchID, fakeBuffer());
    expect(cache.has(stem.stemId)).toBe(true); // still in (lots of room)

    // Second load with cache hit should not touch decoder again.
    const buf2 = await loader.load(stem, JAM);
    expect(buf2).toBe(buf1);
    expect(dec.decode).toHaveBeenCalledTimes(1);
  });

  it('passes the decoded format through to the decoder', async () => {
    const cache = createAudioBufferCache({ maxBytes: 1 << 20 });
    const src = byteSource();
    const dec = decoder();
    const loader = createStemLoader({ source: src, decoder: dec, cache });

    await loader.load(resolved('a', 'flac'), JAM);
    expect(dec.decode).toHaveBeenCalledWith(expect.any(Uint8Array), 'flac');

    await loader.load(resolved('b', 'ogg'), JAM);
    expect(dec.decode).toHaveBeenLastCalledWith(expect.any(Uint8Array), 'ogg');
  });

  it('peek returns the cached buffer synchronously, undefined when missing', () => {
    const cache = createAudioBufferCache({ maxBytes: 1 << 20 });
    const loader = createStemLoader({
      source: byteSource(),
      decoder: decoder(),
      cache,
    });
    const stem = resolved('s1');
    expect(loader.peek(stem.stemId)).toBeUndefined();
    const buf = fakeBuffer();
    cache.put(stem.stemId, buf);
    expect(loader.peek(stem.stemId)).toBe(buf);
  });

  it('a failed decode rejects all coalesced waiters and clears the in-flight slot', async () => {
    const cache = createAudioBufferCache({ maxBytes: 1 << 20 });
    const stem = resolved('s1');
    const src = byteSource();

    let rejectDecode: (e: Error) => void = () => {};
    const failingPromise = new Promise<AudioBufferLike>((_res, rej) => {
      rejectDecode = rej;
    });
    const dec = {
      decode: vi
        .fn()
        .mockReturnValueOnce(failingPromise)
        .mockResolvedValueOnce(fakeBuffer()),
    } as unknown as Decoder & { decode: ReturnType<typeof vi.fn> };
    const loader = createStemLoader({ source: src, decoder: dec, cache });

    const p1 = loader.load(stem, JAM);
    const p2 = loader.load(stem, JAM);
    rejectDecode(new Error('boom'));

    await expect(p1).rejects.toThrow('boom');
    await expect(p2).rejects.toThrow('boom');

    // Slot cleared — retrying should re-fetch and re-decode.
    const buf = await loader.load(stem, JAM);
    expect(buf).toBeDefined();
    expect(dec.decode).toHaveBeenCalledTimes(2);
    expect(src.fetch).toHaveBeenCalledTimes(2);
  });
});
