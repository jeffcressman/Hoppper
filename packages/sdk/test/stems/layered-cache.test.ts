import { describe, it, expect } from 'vitest';
import { InMemoryStemCache } from '../../src/stems/in-memory-cache.js';
import { LayeredStemCache } from '../../src/stems/layered-cache.js';
import { ReadonlyCacheError, type StemCache } from '../../src/stems/cache.js';

const bytes = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x10, 0x20]);
const jamId = 'band-jam-1';

function makeReadonly(entries: Array<{ stemId: string; jamId: string; format: 'flac' | 'ogg'; bytes: Uint8Array }>): StemCache {
  const map = new Map(entries.map((e) => [e.stemId, e]));
  return {
    writable: false,
    async has(stemId) {
      return map.has(stemId);
    },
    async get(stemId) {
      const e = map.get(stemId);
      if (!e) return null;
      return {
        bytes: e.bytes,
        format: e.format,
        length: e.bytes.length,
        jamId: e.jamId,
        source: 'lore',
      };
    },
    async put() {
      throw new ReadonlyCacheError('put');
    },
  };
}

describe('LayeredStemCache', () => {
  it('reports writable=true when any tier is writable', () => {
    const ro = makeReadonly([]);
    const mem = new InMemoryStemCache();
    expect(new LayeredStemCache({ tiers: [ro, mem] }).writable).toBe(true);
    expect(new LayeredStemCache({ tiers: [mem, ro] }).writable).toBe(true);
  });

  it('reports writable=false when all tiers are read-only', () => {
    const ro1 = makeReadonly([]);
    const ro2 = makeReadonly([]);
    expect(new LayeredStemCache({ tiers: [ro1, ro2] }).writable).toBe(false);
  });

  it('returns null when no tier has the stem', async () => {
    const layered = new LayeredStemCache({
      tiers: [makeReadonly([]), new InMemoryStemCache()],
    });
    await expect(layered.has('missing')).resolves.toBe(false);
    await expect(layered.get('missing')).resolves.toBeNull();
  });

  it('walks tiers in order — first hit wins', async () => {
    const mem = new InMemoryStemCache();
    await mem.put({ stemId: 'shared', jamId, format: 'flac' }, new Uint8Array([1, 2]));
    const ro = makeReadonly([{ stemId: 'shared', jamId, format: 'flac', bytes: new Uint8Array([9, 9]) }]);

    const layered = new LayeredStemCache({ tiers: [mem, ro], promoteOnRead: false });
    const blob = await layered.get('shared');
    expect(blob?.source).toBe('memory');
    expect(Array.from(blob!.bytes)).toEqual([1, 2]);
  });

  it('put() goes to the first writable tier only', async () => {
    const mem1 = new InMemoryStemCache();
    const mem2 = new InMemoryStemCache();
    const ro = makeReadonly([]);

    const layered = new LayeredStemCache({ tiers: [ro, mem1, mem2] });
    await layered.put({ stemId: 'new', jamId, format: 'flac' }, bytes);

    await expect(mem1.has('new')).resolves.toBe(true);
    await expect(mem2.has('new')).resolves.toBe(false);
  });

  it('put() throws ReadonlyCacheError when no tier is writable', async () => {
    const layered = new LayeredStemCache({ tiers: [makeReadonly([]), makeReadonly([])] });
    await expect(
      layered.put({ stemId: 'x', jamId, format: 'flac' }, bytes),
    ).rejects.toBeInstanceOf(ReadonlyCacheError);
  });

  it('promoteOnRead copies bytes from a read-only tier into the first writable tier', async () => {
    const writable = new InMemoryStemCache();
    const ro = makeReadonly([{ stemId: 'promote-me', jamId, format: 'flac', bytes }]);
    const layered = new LayeredStemCache({ tiers: [writable, ro], promoteOnRead: true });

    // Sanity: writable starts empty.
    await expect(writable.has('promote-me')).resolves.toBe(false);

    const blob = await layered.get('promote-me');
    expect(blob?.source).toBe('lore');

    // Wait for the background promote to settle.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    await expect(writable.has('promote-me')).resolves.toBe(true);
    const inWritable = await writable.get('promote-me');
    expect(Array.from(inWritable!.bytes)).toEqual(Array.from(bytes));
    expect(inWritable!.jamId).toBe(jamId);
  });

  it('does not promote when a hit comes from the first writable tier itself', async () => {
    const writable = new InMemoryStemCache();
    await writable.put({ stemId: 'already', jamId, format: 'flac' }, bytes);

    let extraPuts = 0;
    const spy: StemCache = {
      writable: true,
      async has(s) { return writable.has(s); },
      async get(s) { return writable.get(s); },
      async put(...args) { extraPuts++; return writable.put(...args); },
    };
    const ro = makeReadonly([]);

    const layered = new LayeredStemCache({ tiers: [spy, ro], promoteOnRead: true });
    await layered.get('already');
    await new Promise((r) => setTimeout(r, 0));
    expect(extraPuts).toBe(0);
  });

  it('promoteOnRead defaults to true', async () => {
    const writable = new InMemoryStemCache();
    const ro = makeReadonly([{ stemId: 'auto', jamId, format: 'flac', bytes }]);
    const layered = new LayeredStemCache({ tiers: [writable, ro] });

    await layered.get('auto');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await expect(writable.has('auto')).resolves.toBe(true);
  });

  it('has() returns true if any tier has the stem', async () => {
    const writable = new InMemoryStemCache();
    const ro = makeReadonly([{ stemId: 'in-ro', jamId, format: 'flac', bytes }]);
    const layered = new LayeredStemCache({ tiers: [writable, ro] });

    await expect(layered.has('in-ro')).resolves.toBe(true);
    await expect(layered.has('missing')).resolves.toBe(false);
  });
});
