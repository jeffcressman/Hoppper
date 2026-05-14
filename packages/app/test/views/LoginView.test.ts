import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

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
  useJamsStore: () => ({}),
  useCurrentJamStore: () => ({}),
}));

const routerPush = vi.hoisted(() => vi.fn());
vi.mock('vue-router', async (orig) => {
  const actual = await orig<typeof import('vue-router')>();
  return { ...actual, useRouter: () => ({ push: routerPush }) };
});

import LoginView from '../../src/views/LoginView.vue';

beforeEach(() => {
  sessionStub.session = null;
  sessionStub.authError = null;
  sessionStub.isAuthenticated = false;
  sessionStub.login.mockReset();
  sessionStub.login.mockResolvedValue(undefined);
  routerPush.mockReset();
});

describe('LoginView', () => {
  it('renders username and password inputs and a submit button', () => {
    const wrapper = mount(LoginView);
    expect(wrapper.find('input[name="username"]').exists()).toBe(true);
    expect(wrapper.find('input[name="password"]').exists()).toBe(true);
    expect(wrapper.find('button[type="submit"]').exists()).toBe(true);
  });

  it('submits the form by calling sessionStore.login with the entered values', async () => {
    const wrapper = mount(LoginView);
    await wrapper.find('input[name="username"]').setValue('alice');
    await wrapper.find('input[name="password"]').setValue('hunter2');
    await wrapper.find('form').trigger('submit.prevent');

    expect(sessionStub.login).toHaveBeenCalledWith('alice', 'hunter2');
  });

  it('navigates to /jams on successful login', async () => {
    sessionStub.login.mockImplementationOnce(async () => {
      sessionStub.isAuthenticated = true;
    });
    const wrapper = mount(LoginView);
    await wrapper.find('input[name="username"]').setValue('a');
    await wrapper.find('input[name="password"]').setValue('b');
    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((r) => setTimeout(r, 0));

    expect(routerPush).toHaveBeenCalledWith('/jams');
  });

  it('shows an error banner when authError is set', async () => {
    sessionStub.authError = 'bad password';
    const wrapper = mount(LoginView);
    expect(wrapper.text()).toContain('bad password');
  });
});
