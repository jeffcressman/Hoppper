import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { RiffDocument } from '@hoppper/sdk';
import { defineRiffDocsStore } from '../../src/stores/riff-docs';

const doc = (riffId: string) => ({ riffId, jamId: 'band1', bps: 2 }) as RiffDocument;

function client(missing: string[] = []) {
  return {
    getRiffs: vi.fn(async (_jam: string, ids: string[]) =>
      ids.filter((id) => !missing.includes(id)).map(doc),
    ),
  };
}

beforeEach(() => setActivePinia(createPinia()));

describe('rifff documents store', () => {
  it('fetches the rifffs asked for in one request, and keeps each by ID', async () => {
    const c = client();
    const store = defineRiffDocsStore(c)();
    await store.ensure('band1', ['r1', 'r2']);
    expect(c.getRiffs).toHaveBeenCalledTimes(1);
    expect(store.get('r2')?.riffId).toBe('r2');
  });

  it('never asks twice for a rifff it holds — rifff documents never change', async () => {
    const c = client();
    const store = defineRiffDocsStore(c)();
    await store.ensure('band1', ['r1']);
    await store.ensure('band1', ['r1', 'r2']);
    expect(c.getRiffs).toHaveBeenLastCalledWith('band1', ['r2']);
    expect(c.getRiffs).toHaveBeenCalledTimes(2);
  });

  it('shares a request already in flight', async () => {
    const c = client();
    const store = defineRiffDocsStore(c)();
    await Promise.all([store.ensure('band1', ['r1']), store.ensure('band1', ['r1'])]);
    expect(c.getRiffs).toHaveBeenCalledTimes(1);
  });

  it('remembers a rifff Endlesss doesn’t have', async () => {
    const c = client(['gone']);
    const store = defineRiffDocsStore(c)();
    await store.ensure('band1', ['gone']);
    await store.ensure('band1', ['gone']);
    expect(store.get('gone')).toBeNull();
    expect(c.getRiffs).toHaveBeenCalledTimes(1);
  });

  it('can be told about rifffs fetched elsewhere, such as a jam’s pages', () => {
    const c = client();
    const store = defineRiffDocsStore(c)();
    store.remember([doc('r9')]);
    expect(store.get('r9')?.riffId).toBe('r9');
  });

  it('fetch(jamId, riffId) gives one rifff, asking only if it isn’t held', async () => {
    const c = client();
    const store = defineRiffDocsStore(c)();
    store.remember([doc('r1')]);
    expect((await store.fetch('band1', 'r1'))?.riffId).toBe('r1');
    expect(c.getRiffs).not.toHaveBeenCalled();
  });
});
