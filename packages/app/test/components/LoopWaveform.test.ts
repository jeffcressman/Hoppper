import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, enableAutoUnmount, flushPromises } from '@vue/test-utils';
import type { RiffDocument } from '@hoppper/sdk';

enableAutoUnmount(afterEach);

type Head = { riffId: string; positionSec: number; loopSec: number } | null;
const performanceStub = vi.hoisted(() => ({
  slotMuted: [false, false, false, false, false, false, false, false],
  slotLevels: [1, 1, 1, 1, 1, 1, 1, 1],
  head: null as Head,
  playhead: vi.fn(),
  bufferFor: vi.fn(),
}));

vi.mock('../../src/stores', () => ({
  usePerformanceStore: () => performanceStub,
  useStemDocsStore: () => ({
    get: (id: string) => ({ stemId: id, bps: 2, primaryColour: 'ff4d9de0' }),
  }),
}));

import LoopWaveform from '../../src/components/LoopWaveform.vue';

// bps 2 and a 16-sixteenth bar: 2 s bars, 8 of them — a 16 s loop.
function riff(id: string, stems: Array<string | null>): RiffDocument {
  return {
    riffId: id,
    bps: 2,
    barLength: 16,
    slots: Array.from({ length: 8 }, (_, i) =>
      stems[i] ? { on: true, stemId: stems[i]!, gain: 1 } : { on: false, stemId: null, gain: 0 },
    ),
  } as RiffDocument;
}

function decoded(durationSec: number) {
  const data = Float32Array.from({ length: 64 }, (_, i) => (i % 8 === 0 ? 0.9 : 0.1));
  return { numberOfChannels: 1, length: data.length, sampleRate: 64 / durationSec, duration: durationSec, getChannelData: () => data };
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

beforeEach(() => {
  performanceStub.slotMuted = [false, false, false, false, false, false, false, false];
  performanceStub.head = null;
  performanceStub.playhead.mockImplementation(() => performanceStub.head);
  performanceStub.bufferFor.mockReset();
  performanceStub.bufferFor.mockImplementation((id: string) => (id === 'missing' ? undefined : decoded(16)));
});

const rows = (w: ReturnType<typeof mount>) => w.findAll('[data-test="wave-row"]');

describe('LoopWaveform', () => {
  it('draws a row per slot', () => {
    expect(rows(mount(LoopWaveform, { props: { riff: riff('r1', ['a', null, 'b']) } }))).toHaveLength(8);
  });

  it('draws each stem from its decoded audio, and nothing for an empty slot', () => {
    const wrapper = mount(LoopWaveform, { props: { riff: riff('r1', ['a', null, 'missing']) } });
    const d = (i: number) => rows(wrapper)[i]!.find('path').attributes('d') ?? '';
    expect(d(0)).toMatch(/^M0 10/);
    expect(d(1)).toBe('');
    expect(d(2)).toBe('');
  });

  it('marks the loop’s bars', () => {
    const wrapper = mount(LoopWaveform, { props: { riff: riff('r1', ['a']) } });
    expect(wrapper.findAll('[data-test="bar-tick"]').map((t) => t.text())).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });

  it('dims a muted slot’s row', () => {
    performanceStub.slotMuted[0] = true;
    const wrapper = mount(LoopWaveform, { props: { riff: riff('r1', ['a']) } });
    expect(rows(wrapper)[0]!.classes()).toContain('is-muted');
  });

  it('moves the playhead to where the rifff is playing', async () => {
    performanceStub.head = { riffId: 'r1', positionSec: 4, loopSec: 16 };
    const wrapper = mount(LoopWaveform, { props: { riff: riff('r1', ['a']) } });
    await nextFrame();
    await flushPromises();
    const head = wrapper.find('[data-test="playhead"]');
    expect(head.exists()).toBe(true);
    expect(head.attributes('style')).toContain('left: 25%');
  });

  it('hides the playhead while another rifff, or none, is playing', async () => {
    performanceStub.head = { riffId: 'other', positionSec: 4, loopSec: 16 };
    const wrapper = mount(LoopWaveform, { props: { riff: riff('r1', ['a']) } });
    await nextFrame();
    await flushPromises();
    expect(wrapper.find('[data-test="playhead"]').exists()).toBe(false);
  });
});
