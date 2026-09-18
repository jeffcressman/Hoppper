import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';

// What the rifff history needs to draw a splat: who committed it, when, and
// its slots.
function riffOf(riffId: string, bpm: number) {
  return { riffId, bpm, userName: 'lwlkc', createdAt: Date.UTC(2026, 8, 14, 12), slots: [] as unknown[] };
}

const jamsStub = vi.hoisted(() => ({
  profilesById: new Map<string, { displayName: string; bio?: string }>(),
  loadProfile: vi.fn(async () => {}),
}));

const currentJamStub = vi.hoisted(() => ({
  jamId: null as null | string,
  riffPage: [] as Array<ReturnType<typeof riffOf>>,
  hasMore: false,
  open: vi.fn(async () => {}),
  loadNextPage: vi.fn(async () => {}),
  close: vi.fn(),
}));

const performanceStub = vi.hoisted(() => ({
  state: 'idle' as 'idle' | 'playing',
  currentRiffId: null as string | null,
  missingStems: [] as string[],
  lastError: null as string | null,
  quantiseEntry: false,
  hopTo: vi.fn(),
  stop: vi.fn(),
  prefetchWindow: vi.fn(async () => {}),
  decodedTick: 0,
  bufferFor: vi.fn(() => undefined),
}));

const recorderStub = vi.hoisted(() => ({
  isRecording: false,
  isArmed: false,
  isPlaying: false,
  playingId: null as string | null,
  saved: [] as Array<{
    id: string;
    title: string;
    jamId: string;
    recordedAt: string;
    durationSec: number;
    hops: unknown[];
    schemaVersion: 1;
  }>,
  lastError: null as string | null,
  start: vi.fn(),
  stop: vi.fn(async () => null),
  loadSaved: vi.fn(async () => {}),
  play: vi.fn(async () => {}),
  stopPlayback: vi.fn(),
  delete: vi.fn(async () => {}),
}));

// The recorder stub is served reactive, like a real Pinia store, so a test
// can change its state after mount and watchers see it. reactive() of the same
// object is always the same proxy.
vi.mock('../../src/stores', async () => {
  const { reactive: toReactive } = await import('vue');
  return {
    useSessionStore: () => ({}),
    useJamsStore: () => jamsStub,
    useCurrentJamStore: () => currentJamStub,
    usePerformanceStore: () => performanceStub,
    useRecorderStore: () => toReactive(recorderStub),
    useStemDocsStore: () => ({ get: () => undefined, ensure: async () => {} }),
  };
});

const routeParams = vi.hoisted(() => ({ jamId: 'band1' as string }));
vi.mock('vue-router', async (orig) => {
  const actual = await orig<typeof import('vue-router')>();
  return {
    ...actual,
    useRoute: () => ({ params: routeParams }),
  };
});

// The mixer and waveform have tests of their own; here they only need to be
// handed the right rifff.
vi.mock('../../src/components/MixerPanel.vue', () => ({
  default: { name: 'MixerPanel', props: ['riff'], template: '<div />' },
}));
vi.mock('../../src/components/LoopWaveform.vue', () => ({
  default: { name: 'LoopWaveform', props: ['riff'], template: '<div />' },
}));

import PerformView from '../../src/views/PerformView.vue';

beforeEach(() => {
  jamsStub.profilesById = new Map();
  jamsStub.loadProfile.mockReset();
  jamsStub.loadProfile.mockResolvedValue(undefined);
  currentJamStub.riffPage = [];
  currentJamStub.hasMore = false;
  currentJamStub.open.mockReset();
  currentJamStub.open.mockResolvedValue(undefined);
  currentJamStub.close.mockReset();
  currentJamStub.loadNextPage.mockReset();
  currentJamStub.loadNextPage.mockResolvedValue(undefined);
  routeParams.jamId = 'band1';

  performanceStub.state = 'idle';
  performanceStub.currentRiffId = null;
  performanceStub.quantiseEntry = false;
  performanceStub.missingStems = [];
  performanceStub.lastError = null;
  performanceStub.hopTo.mockReset();
  performanceStub.stop.mockReset();

  recorderStub.isRecording = false;
  recorderStub.isArmed = false;
  recorderStub.isPlaying = false;
  recorderStub.playingId = null;
  recorderStub.saved = [];
  recorderStub.start.mockReset();
  recorderStub.stop.mockReset();
  recorderStub.stop.mockResolvedValue(null);
  recorderStub.loadSaved.mockReset();
  recorderStub.loadSaved.mockResolvedValue(undefined);
  recorderStub.play.mockReset();
  recorderStub.play.mockResolvedValue(undefined);
  recorderStub.stopPlayback.mockReset();
  recorderStub.delete.mockReset();
  recorderStub.delete.mockResolvedValue(undefined);
});

describe('PerformView', () => {
  it('opens the jam on mount and loads its profile', async () => {
    mount(PerformView);
    await flushPromises();
    expect(jamsStub.loadProfile).toHaveBeenCalledWith('band1');
    expect(currentJamStub.open).toHaveBeenCalledWith('band1');
  });

  it('offers older rifffs when the jam has more', async () => {
    currentJamStub.riffPage = [riffOf('r1', 120)];
    currentJamStub.hasMore = true;
    const wrapper = mount(PerformView);
    await flushPromises();
    await wrapper.find('[data-test="load-more"]').trigger('click');
    expect(currentJamStub.loadNextPage).toHaveBeenCalledTimes(1);
  });

  it('offers no more rifffs once they are all shown', async () => {
    currentJamStub.riffPage = [riffOf('r1', 120)];
    const wrapper = mount(PerformView);
    await flushPromises();
    expect(wrapper.find('[data-test="load-more"]').exists()).toBe(false);
  });

  it('renders a Hop button per riff', async () => {
    currentJamStub.riffPage = [
      riffOf('r1', 120),
      riffOf('r2', 130),
    ];
    const wrapper = mount(PerformView);
    await flushPromises();
    const buttons = wrapper.findAll('[data-test="hop"]');
    expect(buttons).toHaveLength(2);
  });

  it('clicking Hop calls performance.hopTo with the route jamId and the riff', async () => {
    const riff = riffOf('r1', 120);
    currentJamStub.riffPage = [riff];
    performanceStub.hopTo.mockResolvedValue({
      kind: 'started',
      riffId: 'r1',
      whenSec: 0,
    });
    const wrapper = mount(PerformView);
    await flushPromises();
    await wrapper.find('[data-test="hop"]').trigger('click');
    await flushPromises();
    expect(performanceStub.hopTo).toHaveBeenCalledWith('band1', riff);
  });

  it('pulses the row of each rifff still loading after its click', async () => {
    // The row, not just its button: a pulsing button alone was too subtle to
    // notice (2026-09-17).
    currentJamStub.riffPage = [
      riffOf('r1', 120),
      riffOf('r2', 120),
      riffOf('r3', 120),
    ];
    const loads = new Map<string, () => void>();
    performanceStub.hopTo.mockImplementation(
      (_jam: string, r: { riffId: string }) =>
        new Promise((resolve) =>
          loads.set(r.riffId, () =>
            resolve({ kind: 'started', riffId: r.riffId, whenSec: 0, atSec: 0 }),
          ),
        ),
    );
    const wrapper = mount(PerformView);
    await flushPromises();
    const hop = () => wrapper.findAll('[data-test="hop"]');
    const loadingRows = () =>
      wrapper.findAll('[data-test="riff-row"]').map((r) => r.classes().includes('loading'));

    await hop()[0]!.trigger('click');
    await hop()[1]!.trigger('click');
    expect(loadingRows()).toEqual([true, true, false]);

    loads.get('r1')!();
    await flushPromises();
    expect(loadingRows()).toEqual([false, true, false]);
    loads.get('r2')!();
    await flushPromises();
    expect(loadingRows()).toEqual([false, false, false]);
  });

  it('shows the busy badge on the riff that returned not-ready', async () => {
    currentJamStub.riffPage = [riffOf('r1', 120)];
    performanceStub.hopTo.mockResolvedValue({
      kind: 'not-ready',
      missingStemIds: ['s1', 's2'],
    });
    const wrapper = mount(PerformView);
    await flushPromises();
    await wrapper.find('[data-test="hop"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="busy-badge"]').exists()).toBe(true);
  });

  it('says in the header which rifff is playing: when, who, and its tempo', async () => {
    performanceStub.state = 'playing';
    performanceStub.currentRiffId = 'r1';
    currentJamStub.riffPage = [riffOf('r1', 120)];
    const wrapper = mount(PerformView);
    await flushPromises();
    const meta = wrapper.find('[data-test="current-riff"]').text();
    expect(meta).toContain('14 Sep 2026');
    expect(meta).toContain('lwlkc');
    expect(meta).toContain('120 BPM');
  });

  it('shows the playing rifff in the mixer and the waveform', async () => {
    performanceStub.currentRiffId = 'r2';
    currentJamStub.riffPage = [riffOf('r1', 120), riffOf('r2', 120)];
    const wrapper = mount(PerformView);
    await flushPromises();
    expect(wrapper.findComponent({ name: 'MixerPanel' }).props('riff')).toMatchObject({ riffId: 'r2' });
    expect(wrapper.findComponent({ name: 'LoopWaveform' }).props('riff')).toMatchObject({ riffId: 'r2' });
  });

  it('leaving the jam silences it', async () => {
    recorderStub.isPlaying = true;
    const wrapper = mount(PerformView);
    await flushPromises();
    wrapper.unmount();
    expect(performanceStub.stop).toHaveBeenCalled();
    expect(recorderStub.stopPlayback).toHaveBeenCalled();
  });

  it('highlights the row of the rifff that is playing', async () => {
    performanceStub.state = 'playing';
    performanceStub.currentRiffId = 'r2';
    currentJamStub.riffPage = [
      riffOf('r1', 120),
      riffOf('r2', 120),
    ];
    const wrapper = mount(PerformView);
    await flushPromises();
    const rows = wrapper.findAll('[data-test="riff-row"]');
    expect(rows[0]!.classes()).not.toContain('current');
    expect(rows[1]!.classes()).toContain('current');
  });

  it('shows error text when performance.lastError is set', async () => {
    performanceStub.lastError = 'no stems';
    const wrapper = mount(PerformView);
    await flushPromises();
    expect(wrapper.find('[data-test="error"]').text()).toContain('no stems');
  });

});
