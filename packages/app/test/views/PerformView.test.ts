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

  it('shows current riff id in the header when state is playing', async () => {
    performanceStub.state = 'playing';
    performanceStub.currentRiffId = 'r1';
    currentJamStub.riffPage = [riffOf('r1', 120)];
    const wrapper = mount(PerformView);
    await flushPromises();
    expect(wrapper.find('[data-test="current-riff"]').text()).toContain('r1');
  });

  it('Stop button appears when playing and calls performance.stop', async () => {
    performanceStub.state = 'playing';
    performanceStub.currentRiffId = 'r1';
    currentJamStub.riffPage = [riffOf('r1', 120)];
    const wrapper = mount(PerformView);
    await flushPromises();
    const stopBtn = wrapper.find('[data-test="stop"]');
    expect(stopBtn.exists()).toBe(true);
    await stopBtn.trigger('click');
    expect(performanceStub.stop).toHaveBeenCalled();
  });

  it('Stop during a replay cancels the rest of the replay, not just the audio', async () => {
    // Stopping only the engine left the replay's later hops scheduled, and
    // the next one started the audio again.
    performanceStub.state = 'playing';
    recorderStub.isPlaying = true;
    const wrapper = mount(PerformView);
    await flushPromises();
    await wrapper.find('[data-test="stop"]').trigger('click');
    await flushPromises();
    expect(recorderStub.stopPlayback).toHaveBeenCalled();
    expect(performanceStub.stop).toHaveBeenCalled();
  });

  it('Stop is offered while a replay is still loading, before any audio', async () => {
    performanceStub.state = 'idle';
    recorderStub.isPlaying = true;
    const wrapper = mount(PerformView);
    await flushPromises();
    expect(wrapper.find('[data-test="stop"]').exists()).toBe(true);
  });

  it('Stop while recording ends the recording too, and saves it', async () => {
    performanceStub.state = 'playing';
    recorderStub.isRecording = true;
    const wrapper = mount(PerformView);
    await flushPromises();
    await wrapper.find('[data-test="stop"]').trigger('click');
    await flushPromises();
    expect(performanceStub.stop).toHaveBeenCalled();
    expect(recorderStub.stop).toHaveBeenCalled();
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

  it('Stop button is hidden when state is idle', async () => {
    performanceStub.state = 'idle';
    currentJamStub.riffPage = [riffOf('r1', 120)];
    const wrapper = mount(PerformView);
    await flushPromises();
    expect(wrapper.find('[data-test="stop"]').exists()).toBe(false);
  });

  describe('quantised entry toggle', () => {
    it('renders unchecked, since quantised entry is off by default', async () => {
      performanceStub.quantiseEntry = false;
      const wrapper = mount(PerformView);
      await flushPromises();
      const box = wrapper.find('[data-test="quantise-entry"]');
      expect(box.exists()).toBe(true);
      expect((box.element as HTMLInputElement).checked).toBe(false);
    });

    it('switches the store flag when ticked', async () => {
      performanceStub.quantiseEntry = false;
      const wrapper = mount(PerformView);
      await flushPromises();
      await wrapper.find('[data-test="quantise-entry"]').setValue(true);
      expect(performanceStub.quantiseEntry).toBe(true);
    });

    it('reflects the flag being on', async () => {
      performanceStub.quantiseEntry = true;
      const wrapper = mount(PerformView);
      await flushPromises();
      const box = wrapper.find('[data-test="quantise-entry"]');
      expect((box.element as HTMLInputElement).checked).toBe(true);
    });
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

    it('clicking Record stops whatever is playing first', async () => {
      // Every take starts at the beginning of a rifff, so the first click
      // after Record has to be a cold start.
      performanceStub.state = 'playing';
      const wrapper = mount(PerformView);
      await flushPromises();
      await wrapper.find('[data-test="record"]').trigger('click');
      expect(performanceStub.stop).toHaveBeenCalled();
      expect(recorderStub.start).toHaveBeenCalledWith('band1');
      expect(performanceStub.stop.mock.invocationCallOrder[0]).toBeLessThan(
        recorderStub.start.mock.invocationCallOrder[0]!,
      );
    });

    it('clicking Record during a replay stops the replay first', async () => {
      recorderStub.isPlaying = true;
      const wrapper = mount(PerformView);
      await flushPromises();
      await wrapper.find('[data-test="record"]').trigger('click');
      expect(recorderStub.stopPlayback).toHaveBeenCalled();
      expect(recorderStub.stopPlayback.mock.invocationCallOrder[0]).toBeLessThan(
        recorderStub.start.mock.invocationCallOrder[0]!,
      );
    });

    it('while armed, shows that it is waiting for the first rifff, with no clock', async () => {
      recorderStub.isRecording = true;
      recorderStub.isArmed = true;
      const wrapper = mount(PerformView);
      await flushPromises();
      expect(wrapper.find('[data-test="recording-waiting"]').text()).toBe(
        'Waiting for first rifff…',
      );
      expect(wrapper.find('[data-test="recording-elapsed"]').exists()).toBe(false);
    });

    it('starts the elapsed clock at the first rifff, not at Record', async () => {
      vi.useFakeTimers();
      try {
        recorderStub.isRecording = true;
        recorderStub.isArmed = true;
        const wrapper = mount(PerformView);
        await flushPromises();
        // Time spent waiting for the first click isn't part of the take.
        vi.advanceTimersByTime(5000);

        // The first rifff is clicked.
        reactive(recorderStub).isArmed = false;
        await flushPromises();
        expect(wrapper.find('[data-test="recording-waiting"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="recording-elapsed"]').text()).toBe('0:00');
        vi.advanceTimersByTime(1500);
        await flushPromises();
        expect(wrapper.find('[data-test="recording-elapsed"]').text()).toBe('0:01');
      } finally {
        vi.useRealTimers();
      }
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

    it('clicking Stop Recording stops playback too', async () => {
      performanceStub.state = 'playing';
      recorderStub.isRecording = true;
      const wrapper = mount(PerformView);
      await flushPromises();
      await wrapper.find('[data-test="stop-recording"]').trigger('click');
      await flushPromises();
      expect(performanceStub.stop).toHaveBeenCalled();
    });

    it('highlights the saved sequence that is replaying', async () => {
      const take = (id: string) => ({
        schemaVersion: 1 as const,
        id,
        title: `Take ${id}`,
        jamId: 'band1',
        recordedAt: '',
        durationSec: 30,
        hops: [],
      });
      recorderStub.saved = [take('a'), take('b')];
      recorderStub.isPlaying = true;
      recorderStub.playingId = 'b';
      const wrapper = mount(PerformView);
      await flushPromises();
      const rows = wrapper.findAll('[data-test="saved-row"]');
      expect(rows[0]!.classes()).not.toContain('playing');
      expect(rows[1]!.classes()).toContain('playing');
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
