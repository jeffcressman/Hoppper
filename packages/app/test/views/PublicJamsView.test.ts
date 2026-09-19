import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { jamImageUrl } from '@hoppper/sdk';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';

enableAutoUnmount(afterEach);

type Ref = { jamId: string; category: string; joinedAt?: string };
const sessionStub = vi.hoisted(() => ({ isAuthenticated: false }));
const jamsStub = vi.hoisted(() => ({
  listing: null as null | { personal: Ref; subscribed: Ref[]; joinable: Ref[] },
  profilesById: new Map<string, { displayName: string; bio?: string }>(),
  refresh: vi.fn(async () => {}),
  loadProfile: vi.fn(async (_jamId: string) => {}),
}));
const currentJamStub = vi.hoisted(() => ({ lastJamId: null as string | null }));

vi.mock('../../src/stores', async () => {
  const { reactive: r } = await import('vue');
  const session = r(sessionStub);
  return {
    useSessionStore: () => session,
    useJamsStore: () => jamsStub,
    useCurrentJamStore: () => currentJamStub,
    __session: session,
  };
});

const routerPush = vi.hoisted(() => vi.fn());
vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  useRouter: () => ({ push: routerPush }),
}));

vi.mock('../../src/components/LoginDialog.vue', () => ({
  default: { emits: ['close'], template: '<div data-test="login-dialog"><button data-test="close-login" @click="$emit(\'close\')" /></div>' },
}));

import * as stores from '../../src/stores';
import PublicJamsView from '../../src/views/PublicJamsView.vue';

const session = (stores as unknown as { __session: typeof sessionStub }).__session;

beforeEach(() => {
  session.isAuthenticated = false;
  jamsStub.listing = null;
  jamsStub.profilesById = new Map();
  jamsStub.refresh.mockReset().mockResolvedValue(undefined);
  jamsStub.loadProfile.mockReset().mockResolvedValue(undefined);
  currentJamStub.lastJamId = null;
  routerPush.mockReset();
});

const listing = () => ({
  personal: { jamId: 'me', category: 'personal' },
  subscribed: [],
  joinable: [
    { jamId: 'old', category: 'joinable' },
    { jamId: 'mid', category: 'joinable' },
    { jamId: 'new', category: 'joinable' },
  ],
});

describe('PublicJamsView — logged out', () => {
  it('offers a login instead of a list, and asks Endlesss for nothing', () => {
    const wrapper = mount(PublicJamsView);
    expect(wrapper.find('h1').text()).toBe('Public Jams');
    expect(wrapper.text()).toContain('Log in to see public jams');
    expect(wrapper.findAll('[data-test="jam-tile"]')).toHaveLength(0);
    expect(jamsStub.refresh).not.toHaveBeenCalled();
  });

  it('Log in opens the login dialog, and closing it puts it away', async () => {
    const wrapper = mount(PublicJamsView);
    await wrapper.find('[data-test="login"]').trigger('click');
    expect(wrapper.find('[data-test="login-dialog"]').exists()).toBe(true);
    await wrapper.find('[data-test="close-login"]').trigger('click');
    expect(wrapper.find('[data-test="login-dialog"]').exists()).toBe(false);
  });

  it('loads the list as soon as the user logs in', async () => {
    mount(PublicJamsView);
    session.isAuthenticated = true;
    await flushPromises();
    expect(jamsStub.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('PublicJamsView — logged in', () => {
  beforeEach(() => {
    session.isAuthenticated = true;
  });

  it('shows a loading line until the list arrives', () => {
    const wrapper = mount(PublicJamsView);
    expect(wrapper.text().toLowerCase()).toContain('loading');
  });

  it('lists the joinable jams newest first, by name when the profile has one', async () => {
    jamsStub.listing = listing();
    jamsStub.profilesById = new Map([['mid', { displayName: 'Middle Jam', bio: 'Four bars at a time' }]]);
    const wrapper = mount(PublicJamsView);
    await flushPromises();
    const titles = wrapper.findAll('[data-test="jam-title"]').map((t) => t.text());
    expect(titles).toEqual(['new', 'Middle Jam', 'old']);
    expect(wrapper.text()).toContain('Four bars at a time');
    expect(wrapper.text()).toContain('3 jams open to join');
  });

  it('fetches each joinable jam’s profile for its name', async () => {
    jamsStub.listing = listing();
    mount(PublicJamsView);
    await flushPromises();
    expect(jamsStub.loadProfile.mock.calls.map((c) => c[0]).sort()).toEqual(['mid', 'new', 'old']);
  });

  it('shows each jam’s Endlesss image on its tile', async () => {
    jamsStub.listing = listing();
    const wrapper = mount(PublicJamsView);
    await flushPromises();
    const tiles = wrapper.findAll('[data-test="jam-tile"]');
    expect(tiles.length).toBeGreaterThan(0);
    const ids = jamIdsOf(jamsStub.listing);
    tiles.forEach((tile) => expect(ids.map(jamImageUrl)).toContain(tile.find('img').attributes('src')));
  });

  it('opening a jam goes to Hop Recording for it', async () => {
    jamsStub.listing = listing();
    const wrapper = mount(PublicJamsView);
    await flushPromises();
    await wrapper.findAll('[data-test="jam-tile"]')[0].trigger('click');
    expect(routerPush).toHaveBeenCalledWith({ name: 'hop-recording', params: { jamId: 'new' } });
  });

  it('marks the current jam', async () => {
    jamsStub.listing = listing();
    currentJamStub.lastJamId = 'mid';
    const wrapper = mount(PublicJamsView);
    await flushPromises();
    const tiles = wrapper.findAll('[data-test="jam-tile"]');
    expect(tiles[1].text()).toContain('Current');
    expect(tiles[0].text()).not.toContain('Current');
  });

  it('uses the jam list already fetched this session rather than asking again', async () => {
    jamsStub.listing = listing();
    mount(PublicJamsView);
    await flushPromises();
    expect(jamsStub.refresh).not.toHaveBeenCalled();
  });
});

function jamIdsOf(listing: { personal?: { jamId: string } | null; subscribed?: { jamId: string }[]; joinable?: { jamId: string }[] } | null): string[] {
  if (!listing) return [];
  return [
    ...(listing.personal ? [listing.personal.jamId] : []),
    ...(listing.subscribed ?? []).map((j) => j.jamId),
    ...(listing.joinable ?? []).map((j) => j.jamId),
  ];
}
