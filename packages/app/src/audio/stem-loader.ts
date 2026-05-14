import type { JamCouchID, ResolvedStem, StemCouchID } from '@hoppper/sdk';
import type { AudioBufferCache, AudioBufferLike } from './audio-buffer-cache.js';
import type { Decoder } from './decoder.js';

// The audio engine doesn't depend on the SDK's StemFetcher directly — it
// asks for bytes through this narrower seam, so tests can stub it without
// constructing a full HttpTransport + StemCache.
export interface ByteSource {
  fetch(stem: ResolvedStem, jamId: JamCouchID): Promise<Uint8Array>;
}

export interface StemLoader {
  /** Decoded buffer if present in cache, else undefined. Synchronous. */
  peek(stemId: StemCouchID): AudioBufferLike | undefined;

  /** Fetch + decode + cache. Coalesces concurrent loads of the same stem. */
  load(stem: ResolvedStem, jamId: JamCouchID): Promise<AudioBufferLike>;
}

export interface StemLoaderOptions {
  source: ByteSource;
  decoder: Decoder;
  cache: AudioBufferCache;
}

export function createStemLoader(opts: StemLoaderOptions): StemLoader {
  const { source, decoder, cache } = opts;
  const inflight = new Map<StemCouchID, Promise<AudioBufferLike>>();

  function loadFresh(
    stem: ResolvedStem,
    jamId: JamCouchID,
  ): Promise<AudioBufferLike> {
    const work = (async () => {
      const bytes = await source.fetch(stem, jamId);
      const buffer = await decoder.decode(bytes, stem.format);
      cache.put(stem.stemId, buffer);
      return buffer;
    })();
    // Always clear the slot, success or failure, before the awaiter sees the result.
    const tracked = work.finally(() => {
      inflight.delete(stem.stemId);
    });
    inflight.set(stem.stemId, tracked);
    return tracked;
  }

  return {
    peek(stemId) {
      return cache.get(stemId);
    },
    async load(stem, jamId) {
      const cached = cache.get(stem.stemId);
      if (cached !== undefined) return cached;
      const pending = inflight.get(stem.stemId);
      if (pending !== undefined) return pending;
      return loadFresh(stem, jamId);
    },
  };
}
