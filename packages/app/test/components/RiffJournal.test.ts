import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { RiffDocument, StemDocument } from '@hoppper/sdk';

enableAutoUnmount(afterEach);

const stemClient = vi.hoisted(() => ({
  getStemDocuments: vi.fn(),
}));

// Stems decoded so far, by ID; `decodedTick` moves when one arrives.
const performanceStub = vi.hoisted(() => ({
  decoded: new Map<string, unknown>(),
  decodedTick: 0,
  bufferFor: (id: string): unknown => performanceStub.decoded.get(id),
}));

vi.mock('../../src/stores', async () => {
  const { reactive } = await import('vue');
  const { defineStemDocsStore: define } = await import('../../src/stores/stem-docs');
  const useStemDocsStore = define(stemClient);
  const performance = reactive(performanceStub);
  return { useStemDocsStore, usePerformanceStore: () => performance, __performance: performance };
});

import * as stores from '../../src/stores';
import RiffJournal from '../../src/components/RiffJournal.vue';

const performance = (stores as unknown as { __performance: typeof performanceStub }).__performance;

function decoded() {
  const data = Float32Array.from({ length: 256 }, (_, i) => (i % 32 < 4 ? 0.9 : 0.05));
  return { numberOfChannels: 1, length: 256, sampleRate: 16, duration: 16, getChannelData: () => data };
}

const DAY = (d: number, h: number) => new Date(2026, 8, d, h).getTime();

function riff(id: string, createdAt: number, stems: string[], userName = 'lwlkc'): RiffDocument {
  return {
    riffId: id,
    jamId: 'band1',
    userName,
    createdAt,
    bps: 2,
    bpm: 120,
    barLength: 16,
    root: 0,
    scale: 0,
    slots: Array.from({ length: 8 }, (_, i) =>
      stems[i] ? { on: true, stemId: stems[i], gain: 1 } : { on: false, stemId: null, gain: 0 },
    ),
  };
}

// Newest first, as the jam's rifff pages arrive.
const riffs = [
  riff('r3', DAY(14, 21), ['a', 'b'], 'jrc1'),
  riff('r2', DAY(11, 20), ['c']),
  riff('r1', DAY(11, 19), ['a', 'd', 'e']),
];

beforeEach(() => {
  performanceStub.decoded.clear();
  performance.decodedTick = 0;
  setActivePinia(createPinia());
  stemClient.getStemDocuments.mockReset();
  stemClient.getStemDocuments.mockImplementation(async (_jam: string, ids: string[]) =>
    ids.map((id) => ({ stemId: id, primaryColour: 'ff4d9de0' }) as StemDocument),
  );
});

function mountJournal(props: Partial<InstanceType<typeof RiffJournal>['$props']> = {}) {
  return mount(RiffJournal, {
    props: { jamId: 'band1', riffs, currentRiffId: null, loadingIds: new Set<string>(), notReadyId: null, ...props },
  });
}

describe('RiffJournal', () => {
  it('groups rifffs by day, newest day first', () => {
    const wrapper = mountJournal();
    expect(wrapper.findAll('[data-test="journal-day"]').map((d) => d.text())).toEqual([
      '14 Sep 2026',
      '11 Sep 2026',
    ]);
    const perDay = wrapper.findAll('[data-test="journal-group"]').map((g) => g.findAll('[data-test="hop"]').length);
    expect(perDay).toEqual([1, 2]);
  });

  it('asks for the stem documents of every rifff shown, in one request', async () => {
    mountJournal();
    await flushPromises();
    expect(stemClient.getStemDocuments).toHaveBeenCalledTimes(1);
    expect(stemClient.getStemDocuments.mock.calls[0][1].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('asks only for new stems when more rifffs arrive', async () => {
    const wrapper = mountJournal();
    await flushPromises();
    await wrapper.setProps({ riffs: [...riffs, riff('r0', DAY(2, 19), ['a', 'f'])] });
    await flushPromises();
    expect(stemClient.getStemDocuments).toHaveBeenCalledTimes(2);
    expect(stemClient.getStemDocuments.mock.calls[1][1]).toEqual(['f']);
  });

  it('draws each rifff as a splat with a layer per stem, in the stems’ colours', async () => {
    const wrapper = mountJournal();
    await flushPromises();
    const layers = wrapper.findAll('[data-test="hop"]')[2].findAll('path');
    expect(layers).toHaveLength(3);
    expect(layers[0].attributes('style')).toContain('rgb(77 157 224)');
  });

  it('badges each splat with the initial of whoever committed it', () => {
    const wrapper = mountJournal();
    expect(wrapper.findAll('[data-test="splat-user"]').map((b) => b.text())).toEqual(['J', 'L', 'L']);
  });

  it('rings the rifff that is playing', () => {
    const wrapper = mountJournal({ currentRiffId: 'r2' });
    const rows = wrapper.findAll('[data-test="riff-row"]');
    expect(rows.map((r) => r.classes().includes('current'))).toEqual([false, true, false]);
  });

  it('hops to a rifff when its splat is clicked', async () => {
    const wrapper = mountJournal();
    await wrapper.findAll('[data-test="hop"]')[1].trigger('click');
    expect(wrapper.emitted('hop')).toEqual([[riffs[1]]]);
  });

  it('still shows the splats, uncoloured, if the stem documents can’t be fetched', async () => {
    stemClient.getStemDocuments.mockRejectedValue(new Error('503'));
    const wrapper = mountJournal();
    await flushPromises();
    expect(wrapper.findAll('[data-test="hop"]')).toHaveLength(3);
  });

  describe('splat shapes from the stems’ audio', () => {
    const points = (d: string) => (d.match(/[ML]/g) ?? []).length;

    it('seeds the shape of a stem not decoded yet', async () => {
      const wrapper = mountJournal();
      await flushPromises();
      expect(points(wrapper.findAll('[data-test="hop"]')[1]!.find('path').attributes('d')!)).toBe(40);
    });

    it('wraps a decoded stem’s waveform around the splat, once its audio arrives', async () => {
      const wrapper = mountJournal();
      await flushPromises();
      performanceStub.decoded.set('c', decoded());
      performance.decodedTick += 1;
      await flushPromises();
      const d = wrapper.findAll('[data-test="hop"]')[1]!.find('path').attributes('d')!;
      expect(points(d)).toBe(64);
    });
  });
});
