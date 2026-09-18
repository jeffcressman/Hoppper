import {
  createMemoryHistory,
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
  type Router,
} from 'vue-router';

declare module 'vue-router' {
  interface RouteMeta {
    /** Only a logged-in user can open it; anyone else lands on Public Jams. */
    requiresAuth?: boolean;
  }
}

export interface CreateAppRouterOptions {
  isAuthenticated: () => boolean;
  routes: RouteRecordRaw[];
  // Memory history is the testable default; production wires `createWebHistory`.
  useWebHistory?: boolean;
}

export function createAppRouter(opts: CreateAppRouterOptions): Router {
  const history = opts.useWebHistory ? createWebHistory() : createMemoryHistory();
  const routes: RouteRecordRaw[] = [
    { path: '/', redirect: '/public' },
    // Logging in is a dialog now; an old bookmark to /login lands where the
    // dialog is offered.
    { path: '/login', redirect: '/public' },
    ...opts.routes,
  ];
  const router = createRouter({ history, routes });

  // The list pages stay reachable logged out and offer the login dialog
  // themselves. Only pages that need a session to show anything are guarded.
  router.beforeEach((to) => {
    if (to.meta.requiresAuth && !opts.isAuthenticated()) return '/public';
    return true;
  });

  return router;
}
