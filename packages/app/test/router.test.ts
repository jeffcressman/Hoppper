import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { createAppRouter } from '../src/router';

const Stub = defineComponent({ render: () => h('div') });
const routes = [
  { path: '/public', name: 'public-jams', component: Stub },
  { path: '/mine', name: 'my-jams', component: Stub },
  { path: '/hops', name: 'hops', component: Stub },
  { path: '/settings', name: 'settings', component: Stub },
  { path: '/jams/:jamId', name: 'hop-recording', component: Stub, meta: { requiresAuth: true } },
];

describe('createAppRouter', () => {
  it('opens on Public Jams', async () => {
    const router = createAppRouter({ isAuthenticated: () => false, routes });
    await router.push('/');
    expect(router.currentRoute.value.path).toBe('/public');
  });

  it.each(['/public', '/mine', '/hops', '/settings'])(
    'lets a logged-out user reach %s, which shows its own login prompt',
    async (path) => {
      const router = createAppRouter({ isAuthenticated: () => false, routes });
      await router.push(path);
      expect(router.currentRoute.value.path).toBe(path);
    },
  );

  it('sends a logged-out user who opens a jam to Public Jams', async () => {
    const router = createAppRouter({ isAuthenticated: () => false, routes });
    await router.push('/jams/band1');
    expect(router.currentRoute.value.path).toBe('/public');
  });

  it('lets a logged-in user open a jam', async () => {
    const router = createAppRouter({ isAuthenticated: () => true, routes });
    await router.push('/jams/band1');
    expect(router.currentRoute.value.path).toBe('/jams/band1');
    expect(router.currentRoute.value.params.jamId).toBe('band1');
  });

  it('sends the retired /login route to Public Jams', async () => {
    const router = createAppRouter({ isAuthenticated: () => false, routes });
    await router.push('/login');
    expect(router.currentRoute.value.path).toBe('/public');
  });
});
