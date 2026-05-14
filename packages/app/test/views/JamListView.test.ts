import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { flushPromises } from '@vue/test-utils';

const jamsStub = vi.hoisted(() => ({
  listing: null as null | {
    personal: { jamId: string; category: 'personal' };
    subscribed: { jamId: string; category: 'subscribed' }[];
    joinable: { jamId: string; category: 'joinable' }[];
  },
  profilesById: new Map<string, { displayName: string }>(),
  refresh: vi.fn(async () => {}),
  loadProfile: vi.fn(async () => {}),
}));

vi.mock('../../src/stores', () => ({
  useSessionStore: () => ({}),
  useJamsStore: () => jamsStub,
  useCurrentJamStore: () => ({}),
}));

import JamListView from '../../src/views/JamListView.vue';

beforeEach(() => {
  jamsStub.listing = null;
  jamsStub.profilesById = new Map();
  jamsStub.refresh.mockReset();
  jamsStub.refresh.mockResolvedValue(undefined);
});

describe('JamListView', () => {
  it('triggers jamsStore.refresh on mount', () => {
    mount(JamListView, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } });
    expect(jamsStub.refresh).toHaveBeenCalledTimes(1);
  });

  it('renders three sections (Personal, Subscribed, Joinable)', () => {
    jamsStub.listing = {
      personal: { jamId: 'alice', category: 'personal' },
      subscribed: [{ jamId: 'band1', category: 'subscribed' }],
      joinable: [{ jamId: 'band2', category: 'joinable' }],
    };
    const wrapper = mount(JamListView, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } });
    const text = wrapper.text();
    expect(text).toContain('Personal');
    expect(text).toContain('Subscribed');
    expect(text).toContain('Joinable');
  });

  it('renders a row per jam id', () => {
    jamsStub.listing = {
      personal: { jamId: 'alice', category: 'personal' },
      subscribed: [
        { jamId: 'band1', category: 'subscribed' },
        { jamId: 'band2', category: 'subscribed' },
      ],
      joinable: [{ jamId: 'band3', category: 'joinable' }],
    };
    const wrapper = mount(JamListView, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } });
    const text = wrapper.text();
    expect(text).toContain('alice');
    expect(text).toContain('band1');
    expect(text).toContain('band2');
    expect(text).toContain('band3');
  });

  it('shows a loading placeholder while listing is null', () => {
    jamsStub.listing = null;
    const wrapper = mount(JamListView, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } });
    expect(wrapper.text().toLowerCase()).toContain('loading');
  });

  it('shows displayName from profilesById when loaded', async () => {
    jamsStub.listing = {
      personal: { jamId: 'alice', category: 'personal' },
      subscribed: [{ jamId: 'band1', category: 'subscribed' }],
      joinable: [],
    };
    jamsStub.profilesById = new Map([['band1', { displayName: 'Cool Band' }]]);
    const wrapper = mount(JamListView, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } });
    await flushPromises();
    expect(wrapper.text()).toContain('Cool Band');
  });
});
