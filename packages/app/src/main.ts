import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import {
  EndlesssClient,
  FilesystemStemCache,
  HttpTransport,
  StemFetcher,
} from '@hoppper/sdk';
import App from './App.vue';
import LoginView from './views/LoginView.vue';
import JamListView from './views/JamListView.vue';
import JamDetailView from './views/JamDetailView.vue';
import PerformView from './views/PerformView.vue';
import { initClient } from './client';
import { createAppRouter } from './router';
import { initPerformanceStore, useSessionStore } from './stores';
import { openTokenStore } from './tauri/open-token-store';
import { tauriFsAdapter } from './tauri/fs-adapter';
import {
  createAudioBufferCache,
  createAudioEngine,
  createDecoder,
  createNativeDecoder,
  createPrefetchRing,
  createSdkByteSource,
  createStemLoader,
  getOrCreateAudioContext,
  unlockAudioContext,
} from './audio';
import type { JamCouchID, ResolvedStem, RiffDocument } from '@hoppper/sdk';

async function bootstrap() {
  const tokenStore = await openTokenStore();

  const client = new EndlesssClient({
    fetch: tauriFetch as typeof fetch,
    tokenStore,
    userAgent: 'hoppper/0.0.0',
  });
  initClient(client);

  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);

  const session = useSessionStore();
  await session.hydrate();

  // Audio bootstrap. AudioContext is created lazily — Tauri's webview still
  // honors the autoplay policy, so we resume() on the first user gesture
  // inside PerformView. Stem bytes flow through a Tauri-backed FS cache that
  // shares the layout already validated in Phase 5's self-test.
  const appData = await appLocalDataDir();
  const stemCacheRoot = await join(appData, 'stem-cache');
  const stemCache = new FilesystemStemCache({
    root: stemCacheRoot,
    fs: tauriFsAdapter(),
  });
  const stemTransport = new HttpTransport({
    fetch: tauriFetch as typeof fetch,
    userAgent: 'hoppper/0.0.0',
  });
  const stemFetcher = new StemFetcher({
    transport: stemTransport,
    cache: stemCache,
  });
  const audioContext = getOrCreateAudioContext();
  const decoder = createDecoder({
    ogg: createNativeDecoder(audioContext),
    flac: createNativeDecoder(audioContext),
  });
  const bufferCache = createAudioBufferCache();
  const loader = createStemLoader({
    source: createSdkByteSource(stemFetcher),
    decoder,
    cache: bufferCache,
  });
  const engine = createAudioEngine({ context: audioContext, loader });
  const prefetcher = createPrefetchRing({ loader });

  const resolveStems = async (
    jamId: JamCouchID,
    riff: RiffDocument,
  ): Promise<ResolvedStem[]> => {
    await unlockAudioContext();
    const resolved = await client.getStemUrls(jamId, riff);
    return resolved.filter((r): r is ResolvedStem => r !== null);
  };

  initPerformanceStore({ engine, prefetcher, resolveStems });

  const router = createAppRouter({
    isAuthenticated: () => session.isAuthenticated,
    routes: [
      { path: '/login', name: 'login', component: LoginView },
      { path: '/jams', name: 'jams', component: JamListView },
      { path: '/jams/:jamId', name: 'jam-detail', component: JamDetailView },
      { path: '/jams/:jamId/perform', name: 'perform', component: PerformView },
    ],
    useWebHistory: true,
  });
  app.use(router);

  if (import.meta.env.DEV) {
    (window as unknown as { __hoppperSelfTest?: () => Promise<unknown> }).__hoppperSelfTest =
      () => invoke('stem_cache_self_test', { byte: 0x42 });
  }

  app.mount('#app');
}

void bootstrap();
