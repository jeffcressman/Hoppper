import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { HopSequence } from '../../src/hop-recorder/types';
import { defineExportStore } from '../../src/stores/export';

const take = (id: string) => ({ id, title: `Take ${id}`, durationSec: 1, recordedAt: '2026-09-14T12:00:00.000Z' }) as HopSequence;

function deps() {
  let finishRender: () => void = () => {};
  return {
    chooseFile: vi.fn(async (name: string) => `/out/${name}`),
    render: vi.fn(
      () =>
        new Promise<{ channels: Float32Array[]; sampleRate: number }>((resolve) => {
          finishRender = () => resolve({ channels: [new Float32Array(1)], sampleRate: 48000 });
        }),
    ),
    write: vi.fn(async () => {}),
    finishRender: () => finishRender(),
  };
}

beforeEach(() => setActivePinia(createPinia()));

describe('export store', () => {
  it('says which take is exporting until the file is written', async () => {
    const d = deps();
    const store = defineExportStore(d)();
    const done = store.exportTake(take('a'));
    await Promise.resolve();
    await Promise.resolve();
    expect(store.exportingId).toBe('a');
    d.finishRender();
    await done;
    expect(store.exportingId).toBeNull();
    expect(store.lastSaved).toEqual({ id: 'a', path: '/out/Take a.wav' });
  });

  it('runs one export at a time', async () => {
    const d = deps();
    const store = defineExportStore(d)();
    const first = store.exportTake(take('a'));
    // A second click straight away, while the first dialog is still up.
    await store.exportTake(take('b'));
    expect(d.chooseFile).toHaveBeenCalledTimes(1);
    d.finishRender();
    await first;
  });

  it('keeps the reason when an export fails, and is free for the next', async () => {
    const d = deps();
    d.render.mockRejectedValueOnce(new Error('Couldn’t load rifff B'));
    const store = defineExportStore(d)();
    await store.exportTake(take('a'));
    expect(store.lastError).toEqual({ id: 'a', message: 'Couldn’t load rifff B' });
    expect(store.exportingId).toBeNull();
  });

  it('a cancelled dialog is neither saved nor an error', async () => {
    const d = deps();
    d.chooseFile.mockResolvedValueOnce(null as never);
    const store = defineExportStore(d)();
    await store.exportTake(take('a'));
    expect(store.lastSaved).toBeNull();
    expect(store.lastError).toBeNull();
  });
});
