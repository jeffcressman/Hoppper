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
import { installGlobalErrorCapture, log } from './logging/log-store';
import type { JamCouchID, ResolvedStem, RiffDocument } from '@hoppper/sdk';

async function bootstrap() {
  installGlobalErrorCapture();
  log('info', 'boot', 'bootstrap started');

  log('debug', 'boot', 'opening token store');
  const tokenStore = await openTokenStore();
  log('info', 'boot', 'token store opened');

  log('debug', 'boot', 'creating EndlesssClient');
  const client = new EndlesssClient({
    fetch: tauriFetch as typeof fetch,
    tokenStore,
    userAgent: 'hoppper/0.0.0',
    logger: (entry) => {
      const level = entry.error
        ? 'error'
        : entry.status && entry.status >= 400
          ? 'warn'
          : 'info';
      const status = entry.status ? ` ${entry.status}` : '';
      const tag = entry.error ? ' ERR' : '';
      log(level, 'http', `${entry.method} ${entry.url}${status}${tag} (try ${entry.attempt})`, entry.error);
    },
  });
  initClient(client);
  log('info', 'boot', 'EndlesssClient ready');

  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);

  const session = useSessionStore();
  log('debug', 'boot', 'hydrating session from token store');
  await session.hydrate();
  log('info', 'boot', `session hydrated (authenticated=${session.isAuthenticated})`);

  log('debug', 'boot', 'resolving appLocalDataDir');
  const appData = await appLocalDataDir();
  const stemCacheRoot = await join(appData, 'stem-cache');
  log('debug', 'boot', `stem cache root: ${stemCacheRoot}`);
  const stemCache = new FilesystemStemCache({
    root: stemCacheRoot,
    fs: tauriFsAdapter(),
  });
  const stemTransport = new HttpTransport({
    fetch: tauriFetch as typeof fetch,
    userAgent: 'hoppper/0.0.0',
    logger: (entry) => {
      const level = entry.error
        ? 'error'
        : entry.status && entry.status >= 400
          ? 'warn'
          : 'debug';
      const status = entry.status ? ` ${entry.status}` : '';
      log(level, 'stem-http', `${entry.method} ${entry.url}${status}`, entry.error);
    },
  });
  const stemFetcher = new StemFetcher({
    transport: stemTransport,
    cache: stemCache,
    logger: (entry) => log('warn', 'stem-fetch', JSON.stringify(entry)),
  });
  log('debug', 'boot', 'creating AudioContext (suspended)');
  const audioContext = getOrCreateAudioContext();
  log('debug', 'boot', `AudioContext.state=${audioContext.state} sampleRate=${audioContext.sampleRate}`);
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
  engine.onStateChange((s) => log('info', 'audio', `engine state → ${s}`));

  const resolveStems = async (
    jamId: JamCouchID,
    riff: RiffDocument,
  ): Promise<ResolvedStem[]> => {
    log('debug', 'audio', `resolveStems jam=${jamId} riff=${riff.riffId}`);
    await unlockAudioContext();
    log('debug', 'audio', `AudioContext resumed → ${audioContext.state}`);
    const resolved = await client.getStemUrls(jamId, riff);
    const filtered = resolved.filter((r): r is ResolvedStem => r !== null);
    log('info', 'audio', `resolveStems → ${filtered.length} stems`);
    return filtered;
  };

  initPerformanceStore({ engine, prefetcher, resolveStems });
  log('info', 'boot', 'performance store initialized');

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
  router.afterEach((to, from) => {
    log('debug', 'route', `${from.fullPath} → ${to.fullPath}`);
  });
  app.use(router);

  if (import.meta.env.DEV) {
    (window as unknown as { __hoppperSelfTest?: () => Promise<unknown> }).__hoppperSelfTest =
      () => invoke('stem_cache_self_test', { byte: 0x42 });
  }

  app.mount('#app');
  log('info', 'boot', 'mounted');
}

bootstrap().catch((err) => {
  log('error', 'boot', err instanceof Error ? err.message : String(err), err);
  // eslint-disable-next-line no-console
  console.error('[hoppper] bootstrap failed:', err);
  const root = document.getElementById('app');
  if (root) {
    root.innerHTML = '';
    const pre = document.createElement('pre');
    pre.style.cssText =
      'padding:1rem;margin:1rem;background:#fff5f5;color:#7a0010;font:13px/1.4 ui-monospace,monospace;white-space:pre-wrap;border:1px solid #f0c0c0;border-radius:4px;';
    const message =
      err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err);
    pre.textContent = `Hoppper bootstrap failed:\n\n${message}`;
    root.appendChild(pre);
  }
});