import { describe, it, expect, beforeEach } from 'vitest';
import type { FsAdapter } from '@hoppper/sdk';
import { createSequenceStorage } from '../../src/hop-recorder/storage.js';
import type { HopSequence } from '../../src/hop-recorder/types.js';

const ROOT = '/data/sequences';
const JAM = 'band-A';

function fixture(overrides: Partial<HopSequence> = {}): HopSequence {
  return {
    schemaVersion: 1,
    id: 'seq-1',
    title: 'A take',
    jamId: JAM,
    recordedAt: '2026-05-14T12:00:00.000Z',
    durationSec: 30,
    hops: [
      { tSec: 0, riffId: 'r1', jamId: JAM, transitionMs: 0 },
      { tSec: 8, riffId: 'r2', jamId: JAM, transitionMs: 250 },
    ],
    ...overrides,
  };
}

// In-memory FS adapter just covering the surface we use here.
function memFs(): FsAdapter & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  return {
    files,
    async readFile(path) {
      const v = files.get(path);
      if (v === undefined) {
        const err = new Error(`ENOENT: ${path}`);
        (err as Error & { code: string }).code = 'ENOENT';
        throw err;
      }
      return v;
    },
    async writeFile(path, bytes) {
      files.set(path, bytes);
    },
    async rename(from, to) {
      const v = files.get(from);
      if (v === undefined) {
        const err = new Error(`ENOENT: ${from}`);
        (err as Error & { code: string }).code = 'ENOENT';
        throw err;
      }
      files.set(to, v);
      files.delete(from);
    },
    async unlink(path) {
      files.delete(path);
    },
    async mkdir(path) {
      dirs.add(path);
    },
    async readdir(path) {
      const prefix = path.endsWith('/') ? path : `${path}/`;
      const out = new Set<string>();
      for (const f of files.keys()) {
        if (f.startsWith(prefix)) {
          const rest = f.slice(prefix.length);
          const slashIdx = rest.indexOf('/');
          out.add(slashIdx === -1 ? rest : rest.slice(0, slashIdx));
        }
      }
      if (out.size === 0 && !dirs.has(path)) {
        const err = new Error(`ENOENT: ${path}`);
        (err as Error & { code: string }).code = 'ENOENT';
        throw err;
      }
      return [...out];
    },
    async stat(path) {
      const v = files.get(path);
      return v ? { size: v.byteLength } : null;
    },
  };
}

let fs: ReturnType<typeof memFs>;
beforeEach(() => {
  fs = memFs();
});

describe('createSequenceStorage', () => {
  it('saves a sequence at <root>/<jamId>/<id>.json', async () => {
    const storage = createSequenceStorage({ fs, root: ROOT });
    await storage.saveSequence(fixture());
    expect(fs.files.has(`${ROOT}/${JAM}/seq-1.json`)).toBe(true);
  });

  it('round-trips a saved sequence via loadSequence', async () => {
    const storage = createSequenceStorage({ fs, root: ROOT });
    const seq = fixture();
    await storage.saveSequence(seq);
    const loaded = await storage.loadSequence(JAM, 'seq-1');
    expect(loaded).toEqual(seq);
  });

  it('saveSequence writes to a tmp file then renames (atomic pattern)', async () => {
    // Verify by spying on the order: tmp must be written before final.
    const storage = createSequenceStorage({ fs, root: ROOT });
    const order: string[] = [];
    const origWrite = fs.writeFile.bind(fs);
    fs.writeFile = async (path, bytes) => {
      order.push(`write:${path}`);
      return origWrite(path, bytes);
    };
    const origRename = fs.rename.bind(fs);
    fs.rename = async (from, to) => {
      order.push(`rename:${from}->${to}`);
      return origRename(from, to);
    };
    await storage.saveSequence(fixture());
    expect(order[0]).toMatch(/write:.*\.tmp$/);
    expect(order[1]).toMatch(/rename:.*\.tmp->.*\.json$/);
  });

  it('mkdir is called before the write so the jam folder always exists', async () => {
    const storage = createSequenceStorage({ fs, root: ROOT });
    const calls: string[] = [];
    fs.mkdir = async (path) => {
      calls.push(path);
    };
    await storage.saveSequence(fixture());
    expect(calls.some((p) => p === `${ROOT}/${JAM}`)).toBe(true);
  });

  it('lists sequences for a given jam, sorted newest-first', async () => {
    const storage = createSequenceStorage({ fs, root: ROOT });
    await storage.saveSequence(
      fixture({ id: 'a', recordedAt: '2026-05-01T00:00:00.000Z' }),
    );
    await storage.saveSequence(
      fixture({ id: 'b', recordedAt: '2026-05-14T00:00:00.000Z' }),
    );
    await storage.saveSequence(
      fixture({ id: 'c', recordedAt: '2026-05-10T00:00:00.000Z' }),
    );
    const list = await storage.listSequences(JAM);
    expect(list.map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('listSequences returns [] when the jam folder does not exist', async () => {
    const storage = createSequenceStorage({ fs, root: ROOT });
    const list = await storage.listSequences('jam-with-no-takes');
    expect(list).toEqual([]);
  });

  it('listSequences ignores non-.json entries and malformed files', async () => {
    const storage = createSequenceStorage({ fs, root: ROOT });
    await storage.saveSequence(fixture({ id: 'ok' }));
    // Drop in a non-JSON sibling and a malformed JSON.
    fs.files.set(`${ROOT}/${JAM}/notes.txt`, new TextEncoder().encode('hi'));
    fs.files.set(`${ROOT}/${JAM}/bad.json`, new TextEncoder().encode('not json'));
    const list = await storage.listSequences(JAM);
    expect(list.map((s) => s.id)).toEqual(['ok']);
  });

  it('deleteSequence removes the file; loadSequence then throws', async () => {
    const storage = createSequenceStorage({ fs, root: ROOT });
    await storage.saveSequence(fixture());
    await storage.deleteSequence(JAM, 'seq-1');
    await expect(storage.loadSequence(JAM, 'seq-1')).rejects.toThrow();
  });

  it('loadSequence rejects unknown schemaVersion', async () => {
    const storage = createSequenceStorage({ fs, root: ROOT });
    fs.files.set(
      `${ROOT}/${JAM}/x.json`,
      new TextEncoder().encode(JSON.stringify({ ...fixture(), schemaVersion: 99 })),
    );
    await expect(storage.loadSequence(JAM, 'x')).rejects.toThrow(/schemaVersion/i);
  });
});
