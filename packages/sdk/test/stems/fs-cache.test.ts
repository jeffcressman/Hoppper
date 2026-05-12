import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemStemCache } from '../../src/stems/fs-cache.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hoppper-fs-cache-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const flacKey = {
  stemId: 'abc123def456',
  jamId: 'band-jam-1',
  format: 'flac' as const,
};
const oggKey = {
  stemId: 'fedc4321ba',
  jamId: 'band-jam-2',
  format: 'ogg' as const,
};
const bytes = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x00, 0x99]);

describe('FilesystemStemCache', () => {
  it('is writable', () => {
    const cache = new FilesystemStemCache({ root });
    expect(cache.writable).toBe(true);
  });

  it('has() returns false on an empty cache directory', async () => {
    const cache = new FilesystemStemCache({ root });
    await expect(cache.has('whatever')).resolves.toBe(false);
  });

  it('returns null for unknown stems even on first access (no root yet)', async () => {
    const cache = new FilesystemStemCache({ root: join(root, 'nonexistent-yet') });
    await expect(cache.get('whatever')).resolves.toBeNull();
  });

  it('put() writes to <root>/<jamId>/<firstChar>/<stemId>.<ext>', async () => {
    const cache = new FilesystemStemCache({ root });
    await cache.put(flacKey, bytes);

    const expected = join(root, 'band-jam-1', 'a', 'abc123def456.flac');
    expect(existsSync(expected)).toBe(true);
    expect(Array.from(readFileSync(expected))).toEqual(Array.from(bytes));
  });

  it('round-trips through has/get with source="fs"', async () => {
    const cache = new FilesystemStemCache({ root });
    await cache.put(flacKey, bytes);

    await expect(cache.has(flacKey.stemId)).resolves.toBe(true);
    const blob = await cache.get(flacKey.stemId);
    expect(blob).not.toBeNull();
    expect(Array.from(blob!.bytes)).toEqual(Array.from(bytes));
    expect(blob!.format).toBe('flac');
    expect(blob!.length).toBe(bytes.length);
    expect(blob!.source).toBe('fs');
  });

  it('discovers entries left by a previous session on first access', async () => {
    // Pre-seed an existing V2-layout file
    mkdirSync(join(root, 'band-jam-1', 'a'), { recursive: true });
    writeFileSync(join(root, 'band-jam-1', 'a', 'abc123def456.flac'), bytes);

    const cache = new FilesystemStemCache({ root });
    await expect(cache.has('abc123def456')).resolves.toBe(true);
    const blob = await cache.get('abc123def456');
    expect(blob?.format).toBe('flac');
    expect(Array.from(blob!.bytes)).toEqual(Array.from(bytes));
  });

  it('discovers both .ogg and .flac files in a re-opened cache', async () => {
    mkdirSync(join(root, 'band-jam-1', 'a'), { recursive: true });
    mkdirSync(join(root, 'band-jam-2', 'f'), { recursive: true });
    writeFileSync(join(root, 'band-jam-1', 'a', 'abc123def456.flac'), bytes);
    writeFileSync(join(root, 'band-jam-2', 'f', 'fedc4321ba.ogg'), bytes);

    const cache = new FilesystemStemCache({ root });
    expect((await cache.get('abc123def456'))?.format).toBe('flac');
    expect((await cache.get('fedc4321ba'))?.format).toBe('ogg');
  });

  it('writes atomically via *.tmp + rename (no .tmp left after success)', async () => {
    const cache = new FilesystemStemCache({ root });
    await cache.put(flacKey, bytes);

    const dir = join(root, 'band-jam-1', 'a');
    const files = readDirSafe(dir);
    expect(files).toContain('abc123def456.flac');
    expect(files.find((f) => f.endsWith('.tmp'))).toBeUndefined();
  });

  it('put() overwrites an existing entry', async () => {
    const cache = new FilesystemStemCache({ root });
    await cache.put(flacKey, bytes);
    const replacement = new Uint8Array([0xff, 0xee, 0xdd]);
    await cache.put(flacKey, replacement);

    const blob = await cache.get(flacKey.stemId);
    expect(Array.from(blob!.bytes)).toEqual([0xff, 0xee, 0xdd]);
  });

  it('evict() removes the file and clears the index', async () => {
    const cache = new FilesystemStemCache({ root });
    await cache.put(flacKey, bytes);
    await cache.evict!(flacKey.stemId);

    await expect(cache.has(flacKey.stemId)).resolves.toBe(false);
    const expected = join(root, 'band-jam-1', 'a', 'abc123def456.flac');
    expect(existsSync(expected)).toBe(false);
  });

  it('evict() is a no-op for unknown stems', async () => {
    const cache = new FilesystemStemCache({ root });
    await expect(cache.evict!('missing')).resolves.toBeUndefined();
  });

  it('handles separate jams with overlapping firstChars correctly', async () => {
    const cache = new FilesystemStemCache({ root });
    await cache.put({ stemId: 'a111', jamId: 'jam-x', format: 'flac' }, bytes);
    await cache.put({ stemId: 'a222', jamId: 'jam-y', format: 'flac' }, bytes);

    expect(existsSync(join(root, 'jam-x', 'a', 'a111.flac'))).toBe(true);
    expect(existsSync(join(root, 'jam-y', 'a', 'a222.flac'))).toBe(true);
    expect((await cache.get('a111'))).not.toBeNull();
    expect((await cache.get('a222'))).not.toBeNull();
  });
});

function readDirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
