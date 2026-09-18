import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { RiffDocument, StemDocument } from '@hoppper/sdk';
import { defineStemDocsStore, type StemDocsClient } from '../../src/stores/stem-docs';

function stemDoc(stemId: string, colour = 'ff4d9de0'): StemDocument {
  return {
    stemId,
    bps: 2,
    length16ths: 64,
    originalPitch: 0,
    barLength: 16,
    presetName: 'Mainline',
    creatorUserName: 'lwlkc',
    primaryColour: colour,
    sampleRate: 48000,
    createdAt: 0,
    ogg: null,
    flac: {
      format: 'flac',
      endpoint: 'cdn.example',
      key: `${stemId}.flac`,
      url: `https://cdn.example/${stemId}.flac`,
      length: 1000,
      mime: 'audio/flac',
    },
  };
}

function riff(stemIds: (string | null)[]): RiffDocument {
  return {
    riffId: 'r1',
    jamId: 'band1',
    userName: 'lwlkc',
    createdAt: 0,
    bps: 2,
    bpm: 120,
    barLength: 16,
    root: 0,
    scale: 0,
    slots: Array.from({ length: 8 }, (_, i) => ({
      on: stemIds[i] != null,
      stemId: stemIds[i] ?? null,
      gain: 1,
    })),
  };
}

// Answers with a document for every ID except those listed as missing, which
// come back null as CouchDB's _all_docs reports a not_found row.
function client(missing: string[] = []): StemDocsClient & { getStemDocuments: ReturnType<typeof vi.fn> } {
  return {
    getStemDocuments: vi.fn(async (_jamId: string, ids: string[]) =>
      ids.map((id) => (missing.includes(id) ? null : stemDoc(id))),
    ),
  };
}

beforeEach(() => setActivePinia(createPinia()));

describe('stem documents store', () => {
  it('fetches what it is asked for in one request and remembers each document by ID', async () => {
    const c = client();
    const store = defineStemDocsStore(c)();
    await store.ensure('band1', ['s1', 's2', 's3']);
    expect(c.getStemDocuments).toHaveBeenCalledTimes(1);
    expect(c.getStemDocuments).toHaveBeenCalledWith('band1', ['s1', 's2', 's3']);
    expect(store.get('s2')?.stemId).toBe('s2');
  });

  it('never asks twice for a document it holds — stem documents never change', async () => {
    const c = client();
    const store = defineStemDocsStore(c)();
    await store.ensure('band1', ['s1', 's2']);
    await store.ensure('band1', ['s2', 's1']);
    expect(c.getStemDocuments).toHaveBeenCalledTimes(1);
  });

  it('asks only for the ones it hasn’t seen, once each', async () => {
    const c = client();
    const store = defineStemDocsStore(c)();
    await store.ensure('band1', ['s1']);
    await store.ensure('band1', ['s1', 's2', 's2', 's3']);
    expect(c.getStemDocuments).toHaveBeenLastCalledWith('band1', ['s2', 's3']);
  });

  it('shares a request already in flight instead of sending another', async () => {
    const c = client();
    const store = defineStemDocsStore(c)();
    await Promise.all([store.ensure('band1', ['s1', 's2']), store.ensure('band1', ['s2'])]);
    expect(c.getStemDocuments).toHaveBeenCalledTimes(1);
  });

  it('remembers a stem Endlesss has no document for, rather than asking again', async () => {
    const c = client(['gone']);
    const store = defineStemDocsStore(c)();
    await store.ensure('band1', ['gone']);
    await store.ensure('band1', ['gone']);
    expect(c.getStemDocuments).toHaveBeenCalledTimes(1);
    expect(store.get('gone')).toBeNull();
    expect(store.has('gone')).toBe(true);
  });

  it('remembers nothing from a request that failed, so it can be tried again', async () => {
    const c = client();
    c.getStemDocuments.mockRejectedValueOnce(new Error('503'));
    const store = defineStemDocsStore(c)();
    await expect(store.ensure('band1', ['s1'])).rejects.toThrow('503');
    expect(store.has('s1')).toBe(false);
    await store.ensure('band1', ['s1']);
    expect(store.get('s1')?.stemId).toBe('s1');
  });

  describe('resolve(jamId, riff) — the stems a hop needs', () => {
    it('gives a playable stem per active slot', async () => {
      const store = defineStemDocsStore(client())();
      const stems = await store.resolve('band1', riff(['s1', null, 's2']));
      expect(stems.map((s) => s.stemId)).toEqual(['s1', 's2']);
      expect(stems[0].url).toBe('https://cdn.example/s1.flac');
    });

    it('uses documents already fetched for the splats, so a hop costs no request', async () => {
      const c = client();
      const store = defineStemDocsStore(c)();
      await store.ensure('band1', ['s1', 's2']);
      await store.resolve('band1', riff(['s1', 's2']));
      expect(c.getStemDocuments).toHaveBeenCalledTimes(1);
    });

    it('leaves out stems with no document', async () => {
      const store = defineStemDocsStore(client(['gone']))();
      const stems = await store.resolve('band1', riff(['s1', 'gone']));
      expect(stems.map((s) => s.stemId)).toEqual(['s1']);
    });
  });
});
