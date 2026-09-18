import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import MyJamsView from '../../src/views/MyJamsView.vue';

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
  subscribed: [
    { jamId: 'older', category: 'subscribed', joinedAt: '2025-12-02T12:00:00.000Z' },
    { jamId: 'newer', category: 'subscribed', joinedAt: '2026-01-08T12:00:00.000Z' },
  ],
  joinable: [{ jamId: 'someone-elses', category: 'joinable' }],
});

describe('MyJamsView — logged out', () => {
  it('offers a login instead of a list', () => {
    const wrapper = mount(MyJamsView);
    expect(wrapper.find('h1').text()).toBe('My Jams');
    expect(wrapper.text()).toContain('Log in to see your jams');
    expect(jamsStub.refresh).not.toHaveBeenCalled();
  });

  it('Log in opens the login dialog', async () => {
    const wrapper = mount(MyJamsView);
    await wrapper.find('[data-test="login"]').trigger('click');
    expect(wrapper.find('[data-test="login-dialog"]').exists()).toBe(true);
  });
});

describe('MyJamsView — logged in', () => {
  beforeEach(() => {
    session.isAuthenticated = true;
  });

  it('puts the personal jam first, then joined jams newest first — and nothing joinable', async () => {
    jamsStub.listing = listing();
    jamsStub.profilesById = new Map([['newer', { displayName: 'Hoppper' }]]);
    const wrapper = mount(MyJamsView);
    await flushPromises();
    const titles = wrapper.findAll('[data-test="jam-title"]').map((t) => t.text());
    expect(titles).toEqual(['me', 'Hoppper', 'older']);
  });

  it('badges the personal jam and says when each other jam was joined', async () => {
    jamsStub.listing = listing();
    const wrapper = mount(MyJamsView);
    await flushPromises();
    const tiles = wrapper.findAll('[data-test="jam-tile"]');
    expect(tiles[0].text()).toContain('Personal');
    expect(tiles[0].text()).toContain('Your personal jam');
    expect(tiles[1].text()).toContain('Joined 8 Jan 2026');
    expect(tiles[2].text()).toContain('Joined 2 Dec 2025');
    expect(wrapper.text()).toContain('Your personal jam and the 2 jams you’ve joined');
  });

  it('fetches a profile for each of your jams only', async () => {
    jamsStub.listing = listing();
    mount(MyJamsView);
    await flushPromises();
    expect(jamsStub.loadProfile.mock.calls.map((c) => c[0]).sort()).toEqual(['me', 'newer', 'older']);
  });

  it('opening a jam goes to Hop Recording for it', async () => {
    jamsStub.listing = listing();
    const wrapper = mount(MyJamsView);
    await flushPromises();
    await wrapper.findAll('[data-test="jam-tile"]')[1].trigger('click');
    expect(routerPush).toHaveBeenCalledWith({ name: 'hop-recording', params: { jamId: 'newer' } });
  });

  it('uses the jam list already fetched this session rather than asking again', async () => {
    jamsStub.listing = listing();
    mount(MyJamsView);
    await flushPromises();
    expect(jamsStub.refresh).not.toHaveBeenCalled();
  });
});
