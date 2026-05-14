import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises, RouterLinkStub } from '@vue/test-utils';

const globalMountOptions = {
  global: { stubs: { 'router-link': RouterLinkStub } },
};

const jamsStub = vi.hoisted(() => ({
  profilesById: new Map<string, { displayName: string; bio?: string }>(),
  loadProfile: vi.fn(async () => {}),
}));

const currentJamStub = vi.hoisted(() => ({
  jamId: null as null | string,
  riffPage: [] as Array<{
    riffId: string;
    slots: Array<{ on: boolean }>;
    bpm: number;
    createdAt: number;
  }>,
  hasMore: false,
  open: vi.fn(async () => {}),
  loadNextPage: vi.fn(async () => {}),
  close: vi.fn(),
}));

vi.mock('../../src/stores', () => ({
  useSessionStore: () => ({}),
  useJamsStore: () => jamsStub,
  useCurrentJamStore: () => currentJamStub,
}));

const routeParams = vi.hoisted(() => ({ jamId: 'band1' as string }));
vi.mock('vue-router', async (orig) => {
  const actual = await orig<typeof import('vue-router')>();
  return {
    ...actual,
    useRoute: () => ({ params: routeParams }),
  };
});

import JamDetailView from '../../src/views/JamDetailView.vue';

beforeEach(() => {
  jamsStub.profilesById = new Map();
  jamsStub.loadProfile.mockReset();
  jamsStub.loadProfile.mockResolvedValue(undefined);
  currentJamStub.jamId = null;
  currentJamStub.riffPage = [];
  currentJamStub.hasMore = false;
  currentJamStub.open.mockReset();
  currentJamStub.open.mockResolvedValue(undefined);
  currentJamStub.loadNextPage.mockReset();
  currentJamStub.loadNextPage.mockResolvedValue(undefined);
  currentJamStub.close.mockReset();
  routeParams.jamId = 'band1';
});

describe('JamDetailView', () => {
  it('calls jamsStore.loadProfile and currentJamStore.open for the route jamId on mount', async () => {
    mount(JamDetailView, globalMountOptions);
    await flushPromises();
    expect(jamsStub.loadProfile).toHaveBeenCalledWith('band1');
    expect(currentJamStub.open).toHaveBeenCalledWith('band1');
  });

  it('renders displayName when the profile is in the cache', async () => {
    jamsStub.profilesById = new Map([['band1', { displayName: 'Cool Band', bio: 'a bio' }]]);
    const wrapper = mount(JamDetailView, globalMountOptions);
    await flushPromises();
    expect(wrapper.text()).toContain('Cool Band');
    expect(wrapper.text()).toContain('a bio');
  });

  it('falls back to the raw jam id while profile is loading', () => {
    const wrapper = mount(JamDetailView, globalMountOptions);
    expect(wrapper.text()).toContain('band1');
  });

  it('renders a row per riff', async () => {
    currentJamStub.riffPage = [
      { riffId: 'r1', bpm: 120, createdAt: 1, slots: [{ on: true }, { on: false }] },
      { riffId: 'r2', bpm: 130, createdAt: 2, slots: [{ on: true }] },
    ];
    const wrapper = mount(JamDetailView, globalMountOptions);
    const rows = wrapper.findAll('[data-test="riff-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain('r1');
    expect(rows[1]!.text()).toContain('r2');
  });

  it('shows the Load more button when hasMore=true, and calls loadNextPage when clicked', async () => {
    currentJamStub.hasMore = true;
    const wrapper = mount(JamDetailView, globalMountOptions);
    const btn = wrapper.find('[data-test="load-more"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    expect(currentJamStub.loadNextPage).toHaveBeenCalled();
  });

  it('hides Load more when hasMore=false', () => {
    currentJamStub.hasMore = false;
    const wrapper = mount(JamDetailView, globalMountOptions);
    expect(wrapper.find('[data-test="load-more"]').exists()).toBe(false);
  });
});
