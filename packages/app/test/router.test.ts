import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { createAppRouter } from '../src/router';

const Stub = defineComponent({ render: () => h('div') });
const routes = [
  { path: '/login', name: 'login', component: Stub },
  { path: '/jams', name: 'jams', component: Stub },
  { path: '/jams/:jamId', name: 'jam-detail', component: Stub },
];

describe('createAppRouter auth guard', () => {
  it('redirects to /login when unauthenticated', async () => {
    const router = createAppRouter({ isAuthenticated: () => false, routes });
    await router.push('/jams');
    expect(router.currentRoute.value.path).toBe('/login');
  });

  it('lets /login through even when unauthenticated', async () => {
    const router = createAppRouter({ isAuthenticated: () => false, routes });
    await router.push('/login');
    expect(router.currentRoute.value.path).toBe('/login');
  });

  it('lets authenticated nav through to /jams', async () => {
    const router = createAppRouter({ isAuthenticated: () => true, routes });
    await router.push('/jams');
    expect(router.currentRoute.value.path).toBe('/jams');
  });

  it('lets authenticated nav through to /jams/:jamId', async () => {
    const router = createAppRouter({ isAuthenticated: () => true, routes });
    await router.push('/jams/band1');
    expect(router.currentRoute.value.path).toBe('/jams/band1');
    expect(router.currentRoute.value.params.jamId).toBe('band1');
  });

  it('redirects an authenticated user landing on /login to /jams', async () => {
    const router = createAppRouter({ isAuthenticated: () => true, routes });
    await router.push('/login');
    expect(router.currentRoute.value.path).toBe('/jams');
  });

  it('defaults the root path to /jams', async () => {
    const router = createAppRouter({ isAuthenticated: () => true, routes });
    await router.push('/');
    expect(router.currentRoute.value.path).toBe('/jams');
  });
});
