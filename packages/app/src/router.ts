import {
  createMemoryHistory,
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
  type Router,
} from 'vue-router';

export interface CreateAppRouterOptions {
  isAuthenticated: () => boolean;
  routes: RouteRecordRaw[];
  // Memory history is the testable default; production wires `createWebHistory`.
  useWebHistory?: boolean;
}

export function createAppRouter(opts: CreateAppRouterOptions): Router {
  const history = opts.useWebHistory ? createWebHistory() : createMemoryHistory();
  const routes: RouteRecordRaw[] = [
    { path: '/', redirect: '/jams' },
    ...opts.routes,
  ];
  const router = createRouter({ history, routes });

  router.beforeEach((to) => {
    const authed = opts.isAuthenticated();
    if (to.path === '/login') {
      // Authenticated users that hit /login (e.g., bookmark) bounce to /jams.
      return authed ? '/jams' : true;
    }
    if (!authed) return '/login';
    return true;
  });

  return router;
}
