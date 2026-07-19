import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const jamsStub = vi.hoisted(() => ({
  profilesById: new Map<string, { displayName: string; bio?: string }>(),
  loadProfile: vi.fn(async () => {}),
}));

const currentJamStub = vi.hoisted(() => ({
  jamId: null as null | string,
  riffPage: [] as Array<{ riffId: string; bpm: number; slots: unknown[] }>,
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
  hopTo: vi.fn(),
  stop: vi.fn(),
  prefetchWindow: vi.fn(async () => {}),
}));

const recorderStub = vi.hoisted(() => ({
  isRecording: false,
  isPlaying: false,
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

vi.mock('../../src/stores', () => ({
  useSessionStore: () => ({}),
  useJamsStore: () => jamsStub,
  useCurrentJamStore: () => currentJamStub,
  usePerformanceStore: () => performanceStub,
  useRecorderStore: () => recorderStub,
}));

const routeParams = vi.hoisted(() => ({ jamId: 'band1' as string }));
vi.mock('vue-router', async (orig) => {
  const actual = await orig<typeof import('vue-router')>();
  return {
    ...actual,
    useRoute: () => ({ params: routeParams }),
  };
});

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
  routeParams.jamId = 'band1';

  performanceStub.state = 'idle';
  performanceStub.currentRiffId = null;
  performanceStub.missingStems = [];
  performanceStub.lastError = null;
  performanceStub.hopTo.mockReset();
  performanceStub.stop.mockReset();

  recorderStub.isRecording = false;
  recorderStub.isPlaying = false;
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

  it('renders a Hop button per riff', async () => {
    currentJamStub.riffPage = [
      { riffId: 'r1', bpm: 120, slots: [] },
      { riffId: 'r2', bpm: 130, slots: [] },
    ];
    const wrapper = mount(PerformView);
    await flushPromises();
    const buttons = wrapper.findAll('[data-test="hop"]');
    expect(buttons).toHaveLength(2);
  });

  it('clicking Hop calls performance.hopTo with the route jamId and the riff', async () => {
    const riff = { riffId: 'r1', bpm: 120, slots: [] };
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

  it('shows the busy badge on the riff that returned not-ready', async () => {
    currentJamStub.riffPage = [{ riffId: 'r1', bpm: 120, slots: [] }];
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

  it('shows current riff id in the header when state is playing', async () => {
    performanceStub.state = 'playing';
    performanceStub.currentRiffId = 'r1';
    currentJamStub.riffPage = [{ riffId: 'r1', bpm: 120, slots: [] }];
    const wrapper = mount(PerformView);
    await flushPromises();
    expect(wrapper.find('[data-test="current-riff"]').text()).toContain('r1');
  });

  it('Stop button appears when playing and calls performance.stop', async () => {
    performanceStub.state = 'playing';
    performanceStub.currentRiffId = 'r1';
    currentJamStub.riffPage = [{ riffId: 'r1', bpm: 120, slots: [] }];
    const wrapper = mount(PerformView);
    await flushPromises();
    const stopBtn = wrapper.find('[data-test="stop"]');
    expect(stopBtn.exists()).toBe(true);
    await stopBtn.trigger('click');
    expect(performanceStub.stop).toHaveBeenCalled();
  });

  it('Stop button is hidden when state is idle', async () => {
    performanceStub.state = 'idle';
    currentJamStub.riffPage = [{ riffId: 'r1', bpm: 120, slots: [] }];
    const wrapper = mount(PerformView);
    await flushPromises();
    expect(wrapper.find('[data-test="stop"]').exists()).toBe(false);
  });

  it('shows error text when performance.lastError is set', async () => {
    performanceStub.lastError = 'no stems';
    const wrapper = mount(PerformView);
    await flushPromises();
    expect(wrapper.find('[data-test="error"]').text()).toContain('no stems');
  });

  describe('recording', () => {
    it('loads saved sequences on mount', async () => {
      mount(PerformView);
      await flushPromises();
      expect(recorderStub.loadSaved).toHaveBeenCalledWith('band1');
    });

    it('Record button is visible when idle', async () => {
      const wrapper = mount(PerformView);
      await flushPromises();
      expect(wrapper.find('[data-test="record"]').exists()).toBe(true);
    });

    it('clicking Record calls recorder.start with the route jamId', async () => {
      const wrapper = mount(PerformView);
      await flushPromises();
      await wrapper.find('[data-test="record"]').trigger('click');
      expect(recorderStub.start).toHaveBeenCalledWith('band1');
    });

    it('shows a Stop Recording button while recording', async () => {
      recorderStub.isRecording = true;
      const wrapper = mount(PerformView);
      await flushPromises();
      expect(wrapper.find('[data-test="stop-recording"]').exists()).toBe(true);
    });

    it('clicking Stop Recording calls recorder.stop', async () => {
      recorderStub.isRecording = true;
      const wrapper = mount(PerformView);
      await flushPromises();
      await wrapper.find('[data-test="stop-recording"]').trigger('click');
      await flushPromises();
      expect(recorderStub.stop).toHaveBeenCalled();
    });

    it('renders a row per saved sequence', async () => {
      recorderStub.saved = [
        {
          schemaVersion: 1,
          id: 'a',
          title: 'Take A',
          jamId: 'band1',
          recordedAt: '2026-05-14T00:00:00.000Z',
          durationSec: 30,
          hops: [],
        },
        {
          schemaVersion: 1,
          id: 'b',
          title: 'Take B',
          jamId: 'band1',
          recordedAt: '2026-05-14T01:00:00.000Z',
          durationSec: 60,
          hops: [],
        },
      ];
      const wrapper = mount(PerformView);
      await flushPromises();
      expect(wrapper.findAll('[data-test="saved-row"]')).toHaveLength(2);
    });

    it('clicking Play on a saved row calls recorder.play with that sequence', async () => {
      const seq = {
        schemaVersion: 1 as const,
        id: 'a',
        title: 'Take A',
        jamId: 'band1',
        recordedAt: '',
        durationSec: 30,
        hops: [],
      };
      recorderStub.saved = [seq];
      const wrapper = mount(PerformView);
      await flushPromises();
      await wrapper.find('[data-test="play-saved"]').trigger('click');
      expect(recorderStub.play).toHaveBeenCalledWith(seq);
    });

    it('clicking Delete on a saved row calls recorder.delete', async () => {
      recorderStub.saved = [
        {
          schemaVersion: 1,
          id: 'a',
          title: 'Take A',
          jamId: 'band1',
          recordedAt: '',
          durationSec: 30,
          hops: [],
        },
      ];
      const wrapper = mount(PerformView);
      await flushPromises();
      await wrapper.find('[data-test="delete-saved"]').trigger('click');
      expect(recorderStub.delete).toHaveBeenCalledWith('band1', 'a');
    });

    it('renders the saved sequence duration in mm:ss format', async () => {
      recorderStub.saved = [
        {
          schemaVersion: 1,
          id: 'a',
          title: 'Take A',
          jamId: 'band1',
          recordedAt: '',
          durationSec: 75, // 1:15
          hops: [],
        },
      ];
      const wrapper = mount(PerformView);
      await flushPromises();
      expect(wrapper.find('[data-test="saved-duration"]').text()).toBe('1:15');
    });

    it('does not show an elapsed clock when not recording', async () => {
      const wrapper = mount(PerformView);
      await flushPromises();
      expect(wrapper.find('[data-test="recording-elapsed"]').exists()).toBe(false);
    });

    it('shows a live elapsed clock when mounted while recording', async () => {
      vi.useFakeTimers();
      try {
        recorderStub.isRecording = true;
        const wrapper = mount(PerformView);
        await flushPromises();
        const clock = wrapper.find('[data-test="recording-elapsed"]');
        expect(clock.exists()).toBe(true);
        expect(clock.text()).toBe('0:00');

        // Advance fake clock and tick the interval to update elapsed.
        vi.advanceTimersByTime(2500);
        await flushPromises();
        expect(
          wrapper.find('[data-test="recording-elapsed"]').text(),
        ).toBe('0:02');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
