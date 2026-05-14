import type { StemCouchID } from '../types/ids.js';
import {
  ReadonlyCacheError,
  type StemBlob,
  type StemCache,
  type StemCachePutKey,
} from './cache.js';

// Composes a stack of stem caches into a single tier-aware view. Lookups walk
// tiers in declared order; writes go to the first writable tier. When a hit
// lands in a tier downstream of the first writable tier, the bytes are
// promoted into that tier in the background so future lookups bypass the
// downstream tier (and so Hoppper becomes self-contained over time when the
// downstream tier is a LORE archive the user may eventually delete).
export class LayeredStemCache implements StemCache {
  readonly writable: boolean;
  private readonly tiers: StemCache[];
  private readonly promoteOnRead: boolean;
  private readonly firstWritableIdx: number;

  constructor(opts: { tiers: StemCache[]; promoteOnRead?: boolean }) {
    this.tiers = opts.tiers;
    this.promoteOnRead = opts.promoteOnRead ?? true;
    this.firstWritableIdx = this.tiers.findIndex((t) => t.writable);
    this.writable = this.firstWritableIdx >= 0;
  }

  async has(stemId: StemCouchID): Promise<boolean> {
    for (const tier of this.tiers) {
      if (await tier.has(stemId)) return true;
    }
    return false;
  }

  async get(stemId: StemCouchID): Promise<StemBlob | null> {
    for (let i = 0; i < this.tiers.length; i++) {
      const blob = await this.tiers[i]!.get(stemId);
      if (!blob) continue;
      if (
        this.promoteOnRead &&
        this.firstWritableIdx >= 0 &&
        i !== this.firstWritableIdx
      ) {
        this.schedulePromote(stemId, blob);
      }
      return blob;
    }
    return null;
  }

  async put(key: StemCachePutKey, bytes: Uint8Array): Promise<void> {
    if (this.firstWritableIdx < 0) throw new ReadonlyCacheError('put');
    await this.tiers[this.firstWritableIdx]!.put(key, bytes);
  }

  private schedulePromote(stemId: StemCouchID, blob: StemBlob): void {
    const target = this.tiers[this.firstWritableIdx]!;
    void target
      .put({ stemId, jamId: blob.jamId, format: blob.format }, blob.bytes)
      .catch(() => {
        // Promote is best-effort; a failure here doesn't affect the caller.
      });
  }
}
