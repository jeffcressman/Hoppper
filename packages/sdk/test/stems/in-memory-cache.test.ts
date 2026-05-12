import { describe, it, expect } from 'vitest';
import { InMemoryStemCache } from '../../src/stems/in-memory-cache.js';

const key = {
  stemId: 'stem-1',
  jamId: 'band-jam-1',
  format: 'flac' as const,
};

const bytes = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x00, 0x01, 0x02, 0x03]); // fLaC magic + some

describe('InMemoryStemCache', () => {
  it('is writable', () => {
    const cache = new InMemoryStemCache();
    expect(cache.writable).toBe(true);
  });

  it('has() returns false for unknown stems', async () => {
    const cache = new InMemoryStemCache();
    await expect(cache.has('stem-missing')).resolves.toBe(false);
  });

  it('get() returns null for unknown stems', async () => {
    const cache = new InMemoryStemCache();
    await expect(cache.get('stem-missing')).resolves.toBeNull();
  });

  it('round-trips bytes through put/get with source="memory"', async () => {
    const cache = new InMemoryStemCache();
    await cache.put(key, bytes);
    const blob = await cache.get(key.stemId);
    expect(blob).not.toBeNull();
    expect(Array.from(blob!.bytes)).toEqual(Array.from(bytes));
    expect(blob!.format).toBe('flac');
    expect(blob!.length).toBe(bytes.length);
    expect(blob!.source).toBe('memory');
  });

  it('has() returns true after put', async () => {
    const cache = new InMemoryStemCache();
    await cache.put(key, bytes);
    await expect(cache.has(key.stemId)).resolves.toBe(true);
  });

  it('put() overwrites an existing entry', async () => {
    const cache = new InMemoryStemCache();
    await cache.put(key, bytes);
    const replacement = new Uint8Array([0xff, 0xee, 0xdd]);
    await cache.put(key, replacement);
    const blob = await cache.get(key.stemId);
    expect(Array.from(blob!.bytes)).toEqual([0xff, 0xee, 0xdd]);
    expect(blob!.length).toBe(3);
  });

  it('evict() removes the entry', async () => {
    const cache = new InMemoryStemCache();
    await cache.put(key, bytes);
    await cache.evict!(key.stemId);
    await expect(cache.has(key.stemId)).resolves.toBe(false);
    await expect(cache.get(key.stemId)).resolves.toBeNull();
  });

  it('evict() is a no-op for unknown stems', async () => {
    const cache = new InMemoryStemCache();
    await expect(cache.evict!('nope')).resolves.toBeUndefined();
  });
});
