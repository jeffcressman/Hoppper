import type { StemCouchID } from '@hoppper/sdk';

// Structural shape of the Web Audio API's AudioBuffer that's relevant to us.
// Declared locally so the cache module is testable without a real AudioContext.
export interface AudioBufferLike {
  length: number;
  numberOfChannels: number;
  sampleRate: number;
  duration: number;
}

export interface AudioBufferCache {
  get(stemId: StemCouchID): AudioBufferLike | undefined;
  has(stemId: StemCouchID): boolean;
  put(stemId: StemCouchID, buffer: AudioBufferLike): void;
  approxBytes(): number;
}

export interface AudioBufferCacheOptions {
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const BYTES_PER_SAMPLE = 4; // Float32

function sizeOf(buffer: AudioBufferLike): number {
  return buffer.length * buffer.numberOfChannels * BYTES_PER_SAMPLE;
}

export function createAudioBufferCache(
  options: AudioBufferCacheOptions = {},
): AudioBufferCache {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  // Map insertion order is the LRU ordering: oldest first, newest last.
  const entries = new Map<StemCouchID, AudioBufferLike>();
  let totalBytes = 0;

  function touch(id: StemCouchID, buffer: AudioBufferLike): void {
    entries.delete(id);
    entries.set(id, buffer);
  }

  function evictUntilUnderCap(): void {
    // Never evict the most-recently-inserted entry, even if it alone exceeds
    // the cap: the caller asked us to hold it and refusing breaks playback.
    while (totalBytes > maxBytes && entries.size > 1) {
      const oldestKey = entries.keys().next().value as StemCouchID;
      const oldest = entries.get(oldestKey);
      if (oldest === undefined) break;
      entries.delete(oldestKey);
      totalBytes -= sizeOf(oldest);
    }
  }

  return {
    get(id) {
      const buf = entries.get(id);
      if (buf === undefined) return undefined;
      touch(id, buf);
      return buf;
    },
    has(id) {
      return entries.has(id);
    },
    put(id, buffer) {
      const existing = entries.get(id);
      if (existing !== undefined) {
        totalBytes -= sizeOf(existing);
        entries.delete(id);
      }
      entries.set(id, buffer);
      totalBytes += sizeOf(buffer);
      evictUntilUnderCap();
    },
    approxBytes() {
      return totalBytes;
    },
  };
}
