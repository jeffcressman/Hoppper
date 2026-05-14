import type { JamCouchID, StemCouchID } from '../types/ids.js';
import type { StemFormat } from '../types/stem.js';

// Bytes for a single stem, with enough metadata for the audio engine to decode
// and for a layered cache to promote bytes from a read-only tier to a writable
// tier without round-tripping the jamId through the caller.
export interface StemBlob {
  bytes: Uint8Array;
  format: StemFormat;
  length: number;
  jamId: JamCouchID;
  source: 'memory' | 'fs' | 'lore' | 'network';
}

// Stems are content-addressed by StemCouchID; jamId is a *placement hint* for
// filesystem-backed caches that mirror LORE's V2 layout. Lookups use stemId only.
export interface StemCachePutKey {
  stemId: StemCouchID;
  jamId: JamCouchID;
  format: StemFormat;
}

export interface StemCache {
  readonly writable: boolean;
  has(stemId: StemCouchID): Promise<boolean>;
  get(stemId: StemCouchID): Promise<StemBlob | null>;
  put(key: StemCachePutKey, bytes: Uint8Array): Promise<void>;
  evict?(stemId: StemCouchID): Promise<void>;
}

export class ReadonlyCacheError extends Error {
  readonly name = 'ReadonlyCacheError';
  constructor(operation: string) {
    super(`Cannot ${operation} a read-only stem cache`);
  }
}
