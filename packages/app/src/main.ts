import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import { EndlesssClient } from '@hoppper/sdk';
import App from './App.vue';
import LoginView from './views/LoginView.vue';
import JamListView from './views/JamListView.vue';
import JamDetailView from './views/JamDetailView.vue';
import { initClient } from './client';
import { createAppRouter } from './router';
import { useSessionStore } from './stores';
import { openTokenStore } from './tauri/open-token-store';

async function bootstrap() {
  const tokenStore = await openTokenStore();

  initClient(
    new EndlesssClient({
      fetch: tauriFetch as typeof fetch,
      tokenStore,
      userAgent: 'hoppper/0.0.0',
    }),
  );

  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);

  // Hydrate session from the vault before installing the router, so the auth
  // guard sees the correct state on the very first navigation.
  const session = useSessionStore();
  await session.hydrate();

  const router = createAppRouter({
    isAuthenticated: () => session.isAuthenticated,
    routes: [
      { path: '/login', name: 'login', component: LoginView },
      { path: '/jams', name: 'jams', component: JamListView },
      { path: '/jams/:jamId', name: 'jam-detail', component: JamDetailView },
    ],
    useWebHistory: true,
  });
  app.use(router);

  // Dev-only helper for the Phase 5 checkpoint walkthrough.
  if (import.meta.env.DEV) {
    (window as unknown as { __hoppperSelfTest?: () => Promise<unknown> }).__hoppperSelfTest =
      () => invoke('stem_cache_self_test', { byte: 0x42 });
  }

  app.mount('#app');
}

void bootstrap();
