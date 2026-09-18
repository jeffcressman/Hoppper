import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';

enableAutoUnmount(afterEach);

const sessionStub = vi.hoisted(() => ({
  isAuthenticated: true,
  session: { userId: 'lwlkc' } as null | { userId: string },
  logout: vi.fn(async () => {}),
}));
const jamsStub = vi.hoisted(() => ({ clear: vi.fn() }));
const currentJamStub = vi.hoisted(() => ({ forget: vi.fn() }));

vi.mock('../../src/stores', () => ({
  useSessionStore: () => sessionStub,
  useJamsStore: () => jamsStub,
  useCurrentJamStore: () => currentJamStub,
}));

const routerPush = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  useRouter: () => ({ push: routerPush }),
}));

vi.mock('../../src/components/LoginDialog.vue', () => ({
  default: { template: '<div data-test="login-dialog" />' },
}));

import SettingsView from '../../src/views/SettingsView.vue';

beforeEach(() => {
  sessionStub.isAuthenticated = true;
  sessionStub.session = { userId: 'lwlkc' };
  sessionStub.logout.mockReset().mockResolvedValue(undefined);
  jamsStub.clear.mockReset();
  currentJamStub.forget.mockReset();
  routerPush.mockReset().mockResolvedValue(undefined);
});

describe('SettingsView', () => {
  it('shows who is logged in', () => {
    const wrapper = mount(SettingsView);
    expect(wrapper.find('h1').text()).toBe('Settings');
    expect(wrapper.text()).toContain('lwlkc');
    expect(wrapper.find('[data-test="logout"]').exists()).toBe(true);
  });

  it('Log out ends the session, forgets that user’s jams and goes to Public Jams', async () => {
    const wrapper = mount(SettingsView);
    await wrapper.find('[data-test="logout"]').trigger('click');
    await flushPromises();
    expect(sessionStub.logout).toHaveBeenCalled();
    expect(jamsStub.clear).toHaveBeenCalled();
    expect(currentJamStub.forget).toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith({ name: 'public-jams' });
  });

  it('says it is logging out while the vault saves', async () => {
    let finish: (() => void) | null = null;
    sessionStub.logout.mockImplementationOnce(() => new Promise<void>((res) => (finish = res)));
    const wrapper = mount(SettingsView);
    await wrapper.find('[data-test="logout"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="logout"]').text()).toContain('Logging out');
    finish!();
    await flushPromises();
  });

  it('offers a login when nobody is logged in', async () => {
    sessionStub.isAuthenticated = false;
    sessionStub.session = null;
    const wrapper = mount(SettingsView);
    expect(wrapper.text()).toContain('You’re not logged in');
    await wrapper.find('[data-test="login"]').trigger('click');
    expect(wrapper.find('[data-test="login-dialog"]').exists()).toBe(true);
  });
});
