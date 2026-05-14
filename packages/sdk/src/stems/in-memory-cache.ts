import type { StemCouchID } from '../types/ids.js';
import type { StemBlob, StemCache, StemCachePutKey } from './cache.js';

export class InMemoryStemCache implements StemCache {
  readonly writable = true;
  private readonly entries = new Map<StemCouchID, StemBlob>();

  async has(stemId: StemCouchID): Promise<boolean> {
    return this.entries.has(stemId);
  }

  async get(stemId: StemCouchID): Promise<StemBlob | null> {
    return this.entries.get(stemId) ?? null;
  }

  async put(key: StemCachePutKey, bytes: Uint8Array): Promise<void> {
    this.entries.set(key.stemId, {
      bytes,
      format: key.format,
      length: bytes.length,
      jamId: key.jamId,
      source: 'memory',
    });
  }

  async evict(stemId: StemCouchID): Promise<void> {
    this.entries.delete(stemId);
  }
}
