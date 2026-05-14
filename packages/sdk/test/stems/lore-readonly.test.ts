import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadonlyLoreStemDir } from '../../src/stems/lore-readonly.js';
import { ReadonlyCacheError } from '../../src/stems/cache.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hoppper-lore-readonly-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const bytesA = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x01, 0x02]); // 'fLaC' + bytes
const bytesB = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0xff, 0xee]); // 'OggS' + bytes

function seedV2(stemV2Root: string, jamId: string, stemId: string, ext: 'flac' | 'ogg', bytes: Uint8Array): void {
  const dir = join(stemV2Root, jamId, stemId.charAt(0));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${stemId}.${ext}`), bytes);
}

describe('ReadonlyLoreStemDir', () => {
  it('is not writable', () => {
    const cache = new ReadonlyLoreStemDir({ stemV2Root: root });
    expect(cache.writable).toBe(false);
  });

  it('put() throws ReadonlyCacheError', async () => {
    const cache = new ReadonlyLoreStemDir({ stemV2Root: root });
    await expect(
      cache.put({ stemId: 'whatever', jamId: 'band-x', format: 'flac' }, bytesA),
    ).rejects.toBeInstanceOf(ReadonlyCacheError);
  });

  it('reads a .flac stem placed under V2 layout', async () => {
    seedV2(root, 'band-jam-1', 'abc123', 'flac', bytesA);
    const cache = new ReadonlyLoreStemDir({ stemV2Root: root });

    await expect(cache.has('abc123')).resolves.toBe(true);
    const blob = await cache.get('abc123');
    expect(blob).not.toBeNull();
    expect(Array.from(blob!.bytes)).toEqual(Array.from(bytesA));
    expect(blob!.format).toBe('flac');
    expect(blob!.source).toBe('lore');
  });

  it('reads a .ogg stem placed under V2 layout', async () => {
    seedV2(root, 'band-jam-2', 'fed987', 'ogg', bytesB);
    const cache = new ReadonlyLoreStemDir({ stemV2Root: root });

    const blob = await cache.get('fed987');
    expect(blob?.format).toBe('ogg');
    expect(Array.from(blob!.bytes)).toEqual(Array.from(bytesB));
  });

  it('returns null and has()=false for an unknown stemId', async () => {
    seedV2(root, 'band-jam-1', 'abc123', 'flac', bytesA);
    const cache = new ReadonlyLoreStemDir({ stemV2Root: root });

    await expect(cache.has('does-not-exist')).resolves.toBe(false);
    await expect(cache.get('does-not-exist')).resolves.toBeNull();
  });

  it('handles a non-existent root gracefully (empty index, no errors)', async () => {
    const cache = new ReadonlyLoreStemDir({ stemV2Root: join(root, 'never-created') });
    await expect(cache.has('anything')).resolves.toBe(false);
    await expect(cache.get('anything')).resolves.toBeNull();
  });

  it('indexes lazily and only once across many calls', async () => {
    seedV2(root, 'band-jam-1', 'abc123', 'flac', bytesA);
    seedV2(root, 'band-jam-2', 'fed987', 'ogg', bytesB);

    // Spy on fs.readdir via a custom adapter.
    let readdirCalls = 0;
    const realFs = await import('node:fs/promises');
    const cache = new ReadonlyLoreStemDir({
      stemV2Root: root,
      fs: {
        readFile: async (p) => {
          const b = await realFs.readFile(p);
          return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
        },
        writeFile: async () => {
          throw new Error('not used');
        },
        rename: async () => {
          throw new Error('not used');
        },
        unlink: async () => {
          throw new Error('not used');
        },
        mkdir: async () => {
          throw new Error('not used');
        },
        readdir: async (p) => {
          readdirCalls++;
          return await realFs.readdir(p);
        },
        stat: async (p) => {
          try {
            const s = await realFs.stat(p);
            return { size: s.size };
          } catch {
            return null;
          }
        },
      },
    });

    await cache.has('abc123');
    await cache.get('abc123');
    await cache.has('fed987');
    await cache.has('does-not-exist');

    // Index is built once: top-level + per-jam + per-firstChar dirs. The exact
    // count varies with directory shape, but importantly it does not grow on
    // subsequent lookups.
    const initialCalls = readdirCalls;
    await cache.has('abc123');
    await cache.get('fed987');
    expect(readdirCalls).toBe(initialCalls);
    expect(initialCalls).toBeGreaterThan(0);
  });

  it('evict() throws ReadonlyCacheError', async () => {
    const cache = new ReadonlyLoreStemDir({ stemV2Root: root });
    await expect(cache.evict!('abc123')).rejects.toBeInstanceOf(ReadonlyCacheError);
  });
});
