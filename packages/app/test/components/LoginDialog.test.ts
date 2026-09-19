import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const sessionStub = vi.hoisted(() => ({
  authError: null as string | null,
  isAuthenticated: false,
  login: vi.fn(async () => {}),
}));

vi.mock('../../src/stores', () => ({
  useSessionStore: () => sessionStub,
}));

import LoginDialog from '../../src/components/LoginDialog.vue';

beforeEach(() => {
  sessionStub.authError = null;
  sessionStub.isAuthenticated = false;
  sessionStub.login.mockReset();
  sessionStub.login.mockResolvedValue(undefined);
});

async function submit(wrapper: ReturnType<typeof mount>, user = 'alice', pass = 'hunter2') {
  await wrapper.find('input[name="username"]').setValue(user);
  await wrapper.find('input[name="password"]').setValue(pass);
  await wrapper.find('form').trigger('submit.prevent');
}

describe('LoginDialog', () => {
  it('asks for an Endlesss username and password', () => {
    const wrapper = mount(LoginDialog);
    expect(wrapper.text()).toContain('Log in to Endlesss');
    expect(wrapper.find('input[name="username"]').exists()).toBe(true);
    expect(wrapper.find('input[name="password"]').attributes('type')).toBe('password');
  });

  it('logs in with what was typed', async () => {
    const wrapper = mount(LoginDialog);
    await submit(wrapper);
    expect(sessionStub.login).toHaveBeenCalledWith('alice', 'hunter2');
  });

  it('closes itself once logged in, leaving the user on the page they were on', async () => {
    sessionStub.login.mockImplementationOnce(async () => {
      sessionStub.isAuthenticated = true;
    });
    const wrapper = mount(LoginDialog);
    await submit(wrapper);
    await flushPromises();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('stays open and shows the error when Endlesss refuses the login', async () => {
    sessionStub.login.mockImplementationOnce(async () => {
      sessionStub.authError = 'bad password';
    });
    const wrapper = mount(LoginDialog);
    await submit(wrapper);
    await flushPromises();
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(wrapper.find('[role="alert"]').text()).toContain('bad password');
  });

  it('shows that it is working while Endlesss takes its time', async () => {
    let finish: (() => void) | null = null;
    sessionStub.login.mockImplementationOnce(() => new Promise<void>((res) => (finish = res)));
    const wrapper = mount(LoginDialog);
    await submit(wrapper);
    expect(wrapper.find('[data-test="login-spinner"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('20–60 seconds');
    finish!();
    await flushPromises();
    expect(wrapper.find('[data-test="login-spinner"]').exists()).toBe(false);
  });

  it('Cancel closes without logging in', async () => {
    const wrapper = mount(LoginDialog);
    await wrapper.find('[data-test="login-cancel"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(sessionStub.login).not.toHaveBeenCalled();
  });
});
