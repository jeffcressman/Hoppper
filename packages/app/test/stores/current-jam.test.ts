import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  defineCurrentJamStore,
  type CurrentJamClient,
} from '../../src/stores/current-jam';
import type { RiffDocument } from '@hoppper/sdk';

function makeRiff(id: string): RiffDocument {
  return {
    riffId: id,
    jamId: 'band1',
    userName: 'alice',
    createdAt: 0,
    bps: 2,
    bpm: 120,
    barLength: 4,
    root: 0,
    scale: 0,
    slots: Array.from({ length: 8 }, () => ({ on: false, stemId: null, gain: 0 })),
  };
}

async function* pages(pageSets: RiffDocument[][]): AsyncGenerator<RiffDocument[], void, void> {
  for (const p of pageSets) yield p;
}

function makeStub(pageSets: RiffDocument[][]): CurrentJamClient {
  return {
    iterateRiffs: vi.fn(() => pages(pageSets)),
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('useCurrentJamStore', () => {
  it('starts empty', () => {
    const useStore = defineCurrentJamStore(makeStub([]));
    const store = useStore();
    expect(store.jamId).toBeNull();
    expect(store.riffPage).toEqual([]);
    expect(store.hasMore).toBe(false);
  });

  it('open(jamId) loads the first page and records the jam id', async () => {
    const useStore = defineCurrentJamStore(
      makeStub([[makeRiff('r1'), makeRiff('r2')]]),
    );
    const store = useStore();

    await store.open('band1');
    expect(store.jamId).toBe('band1');
    expect(store.riffPage.map((r) => r.riffId)).toEqual(['r1', 'r2']);
  });

  it('hasMore=true after open when more pages remain', async () => {
    const useStore = defineCurrentJamStore(
      makeStub([[makeRiff('r1')], [makeRiff('r2')]]),
    );
    const store = useStore();

    await store.open('band1');
    expect(store.hasMore).toBe(true);
  });

  it('loadNextPage appends the next page', async () => {
    const useStore = defineCurrentJamStore(
      makeStub([[makeRiff('r1')], [makeRiff('r2'), makeRiff('r3')]]),
    );
    const store = useStore();

    await store.open('band1');
    await store.loadNextPage();
    expect(store.riffPage.map((r) => r.riffId)).toEqual(['r1', 'r2', 'r3']);
  });

  it('hasMore=false after the iterator is exhausted', async () => {
    const useStore = defineCurrentJamStore(
      makeStub([[makeRiff('r1')]]),
    );
    const store = useStore();

    await store.open('band1');
    expect(store.hasMore).toBe(false);
    await store.loadNextPage();
    expect(store.hasMore).toBe(false);
    expect(store.riffPage).toHaveLength(1);
  });

  it('close resets jamId, riffPage, and hasMore', async () => {
    const useStore = defineCurrentJamStore(
      makeStub([[makeRiff('r1')], [makeRiff('r2')]]),
    );
    const store = useStore();

    await store.open('band1');
    store.close();
    expect(store.jamId).toBeNull();
    expect(store.riffPage).toEqual([]);
    expect(store.hasMore).toBe(false);
  });

  it('open after close starts fresh against the new jam', async () => {
    const client = makeStub([[makeRiff('r1')]]);
    const useStore = defineCurrentJamStore(client);
    const store = useStore();

    await store.open('band1');
    store.close();
    await store.open('band2');

    expect(client.iterateRiffs).toHaveBeenCalledTimes(2);
    expect(client.iterateRiffs).toHaveBeenLastCalledWith('band2', expect.any(Object));
  });
});
