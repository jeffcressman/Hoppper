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

vi.mock('../../src/stores', () => ({
  useSessionStore: () => ({}),
  useJamsStore: () => jamsStub,
  useCurrentJamStore: () => currentJamStub,
  usePerformanceStore: () => performanceStub,
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
});
