import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createAppRouter } from '../../src/router';

const currentJamStub = vi.hoisted(() => ({ lastJamId: null as string | null }));
const sessionStub = vi.hoisted(() => ({ isAuthenticated: true }));
const editorStub = vi.hoisted(() => ({ lastOpened: null as null | { jamId: string; id: string } }));

vi.mock('../../src/stores', () => ({
  useCurrentJamStore: () => currentJamStub,
  useSessionStore: () => sessionStub,
  useHopEditorStore: () => editorStub,
}));

// The transport has tests of its own; here it's only a slot in the bar.
vi.mock('../../src/components/TransportBar.vue', () => ({
  default: { template: '<div data-test="transport" />' },
}));

import AppShell from '../../src/components/AppShell.vue';

const Page = defineComponent({ render: () => h('div', { 'data-test': 'page' }) });
const routes = [
  { path: '/public', name: 'public-jams', component: Page },
  { path: '/mine', name: 'my-jams', component: Page },
  { path: '/hops', name: 'hops', component: Page },
  { path: '/settings', name: 'settings', component: Page },
  { path: '/jams/:jamId', name: 'hop-recording', component: Page, meta: { requiresAuth: true } },
  { path: '/hops/:jamId/:id', name: 'hop-editing', component: Page, meta: { requiresAuth: true } },
];

async function mountAt(path: string) {
  const router = createAppRouter({ isAuthenticated: () => sessionStub.isAuthenticated, routes });
  await router.push(path);
  const wrapper = mount(AppShell, {
    global: { plugins: [router] },
    slots: { default: '<div data-test="content" />' },
  });
  return { wrapper, router };
}

const rail = (wrapper: Awaited<ReturnType<typeof mountAt>>['wrapper']) =>
  wrapper.findAll('[data-test="rail-item"]');
const railItem = (wrapper: Awaited<ReturnType<typeof mountAt>>['wrapper'], label: string) =>
  rail(wrapper).find((b) => b.text() === label)!;

beforeEach(() => {
  editorStub.lastOpened = null;
  currentJamStub.lastJamId = null;
  sessionStub.isAuthenticated = true;
});

describe('AppShell', () => {
  it('shows the Hoppper wordmark, the transport and the page content', async () => {
    const { wrapper } = await mountAt('/public');
    expect(wrapper.find('.lwlkc-wordmark').text()).toBe('Hoppper');
    expect(wrapper.find('.topbar [data-test="transport"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="content"]').exists()).toBe(true);
  });

  it('lists the rail in the order of the sketch, with Account at the foot', async () => {
    const { wrapper } = await mountAt('/public');
    expect(rail(wrapper).map((b) => b.text())).toEqual([
      'Current Jam',
      'My Jams',
      'Public Jams',
      'Hops',
      'Editor',
      'Account',
    ]);
  });

  it('marks the page you are on', async () => {
    const { wrapper } = await mountAt('/mine');
    expect(railItem(wrapper, 'My Jams').classes()).toContain('is-active');
    expect(railItem(wrapper, 'Public Jams').classes()).not.toContain('is-active');
  });

  it.each([
    ['My Jams', '/mine'],
    ['Public Jams', '/public'],
    ['Hops', '/hops'],
  ])('%s goes to %s', async (label, path) => {
    const { wrapper, router } = await mountAt('/settings');
    await railItem(wrapper, label).trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(path);
  });

  it('Current Jam is off until a jam has been opened', async () => {
    const { wrapper } = await mountAt('/public');
    expect(railItem(wrapper, 'Current Jam').attributes('disabled')).toBeDefined();
  });

  it('Current Jam goes back to the last jam opened, and is marked while you are there', async () => {
    currentJamStub.lastJamId = 'band1';
    const { wrapper, router } = await mountAt('/public');
    await railItem(wrapper, 'Current Jam').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/jams/band1');
    expect(railItem(wrapper, 'Current Jam').classes()).toContain('is-active');
  });

  it('Account isn’t built yet, so it is off', async () => {
    const { wrapper } = await mountAt('/public');
    expect(railItem(wrapper, 'Account').attributes('disabled')).toBeDefined();
  });

  it('Editor is off until a take has been opened in it', async () => {
    const { wrapper } = await mountAt('/public');
    expect(railItem(wrapper, 'Editor').attributes('disabled')).toBeDefined();
  });

  it('Editor goes back to the last take edited, and is marked while you are there', async () => {
    editorStub.lastOpened = { jamId: 'band1', id: 'take-1' };
    const { wrapper, router } = await mountAt('/public');
    await railItem(wrapper, 'Editor').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/hops/band1/take-1');
    expect(railItem(wrapper, 'Editor').classes()).toContain('is-active');
  });

  it('the gear opens Settings', async () => {
    const { wrapper, router } = await mountAt('/public');
    await wrapper.find('[data-test="settings"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/settings');
    expect(wrapper.find('[data-test="settings"]').classes()).toContain('lw-iconbtn--active');
  });
});
