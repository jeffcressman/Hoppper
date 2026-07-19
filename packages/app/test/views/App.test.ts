import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const sessionStub = vi.hoisted(() => ({
  session: null as null | object,
  authError: null as string | null,
  isAuthenticated: false,
  login: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
  hydrate: vi.fn(async () => {}),
}));

vi.mock('../../src/stores', () => ({
  useSessionStore: () => sessionStub,
}));

const routerPush = vi.hoisted(() => vi.fn());
vi.mock('vue-router', async (orig) => {
  const actual = await orig<typeof import('vue-router')>();
  return {
    ...actual,
    useRouter: () => ({ push: routerPush }),
    RouterView: { template: '<div data-test="router-view-stub" />' },
  };
});

// LogPanel pulls in a Pinia store. Stub it out so this test doesn't need
// a real Pinia instance.
vi.mock('../../src/views/LogPanel.vue', () => ({
  default: { template: '<div data-test="log-panel-stub" />' },
}));

import App from '../../src/App.vue';

beforeEach(() => {
  sessionStub.isAuthenticated = false;
  sessionStub.logout.mockReset();
  sessionStub.logout.mockResolvedValue(undefined);
  routerPush.mockReset();
});

describe('App', () => {
  it('does not render a logout button when not authenticated', () => {
    sessionStub.isAuthenticated = false;
    const wrapper = mount(App);
    expect(wrapper.find('[data-test="logout"]').exists()).toBe(false);
  });

  it('renders a logout button when authenticated', () => {
    sessionStub.isAuthenticated = true;
    const wrapper = mount(App);
    expect(wrapper.find('[data-test="logout"]').exists()).toBe(true);
  });

  it('clicking logout calls session.logout and routes to /login', async () => {
    sessionStub.isAuthenticated = true;
    const wrapper = mount(App);
    await wrapper.find('[data-test="logout"]').trigger('click');
    await flushPromises();
    expect(sessionStub.logout).toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith('/login');
  });

  it('shows "Logging out…" while logout is in flight', async () => {
    sessionStub.isAuthenticated = true;
    let resolveLogout: (() => void) | null = null;
    sessionStub.logout.mockImplementationOnce(
      () =>
        new Promise<void>((res) => {
          resolveLogout = res;
        }),
    );
    const wrapper = mount(App);
    wrapper.find('[data-test="logout"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="logout"]').text()).toContain('Logging out');

    resolveLogout!();
    await flushPromises();
  });
});
