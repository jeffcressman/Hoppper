import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  RouterView: { template: '<div data-test="router-view-stub" />' },
}));

// The shell and the log panel pull in stores; this test is only about how
// App puts them together.
vi.mock('../../src/components/AppShell.vue', () => ({
  default: { template: '<div data-test="app-shell"><slot /></div>' },
}));
vi.mock('../../src/views/LogPanel.vue', () => ({
  default: { template: '<div data-test="log-panel-stub" />' },
}));

import App from '../../src/App.vue';

describe('App', () => {
  it('shows every page inside the app shell', () => {
    const wrapper = mount(App);
    expect(wrapper.find('[data-test="app-shell"] [data-test="router-view-stub"]').exists()).toBe(true);
  });

  it('keeps the log panel', () => {
    const wrapper = mount(App);
    expect(wrapper.find('[data-test="log-panel-stub"]').exists()).toBe(true);
  });

  it('no longer floats a logout button over the page — it lives in Settings', () => {
    const wrapper = mount(App);
    expect(wrapper.find('[data-test="logout"]').exists()).toBe(false);
  });
});
