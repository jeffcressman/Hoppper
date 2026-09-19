import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import {
  EndlesssClient,
  FilesystemStemCache,
  HttpTransport,
  StemFetcher,
} from '@hoppper/sdk';
import App from './App.vue';
import PublicJamsView from './views/PublicJamsView.vue';
import MyJamsView from './views/MyJamsView.vue';
import HopsView from './views/HopsView.vue';
import SettingsView from './views/SettingsView.vue';
import PerformView from './views/PerformView.vue';
import HopEditingView from './views/HopEditingView.vue';
import './styles/lwlkcing/index.css';
import './styles/components.css';
import { initClient } from './client';
import { createAppRouter } from './router';
import {
  initExportStore,
  initHopEditorStore,
  initPerformanceStore,
  initRecorderStore,
  useJamsStore,
  useRiffDocsStore,
  useSessionStore,
  useStemDocsStore,
} from './stores';
import { openTokenStore } from './tauri/open-token-store';
import { tauriFsAdapter } from './tauri/fs-adapter';
import { endlesssHttpFetch } from './tauri/endlesss-http-fetch';
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
import {
  createHopPlayer,
  createHopRecorder,
  createSequenceStorage,
} from './hop-recorder';
import { installGlobalErrorCapture, log } from './logging/log-store';
import { renderTake, type OfflineContextLike } from './export/render';
import { hopName } from './hop-recorder/naming';
import type {
  JamCouchID,
  ResolvedStem,
  RiffCouchID,
  RiffDocument,
} from '@hoppper/sdk';

async function bootstrap() {
  installGlobalErrorCapture();
  log('info', 'boot', 'bootstrap started');

  log('debug', 'boot', 'opening token store');
  const tokenStore = await openTokenStore();
  log('info', 'boot', 'token store opened');

  log('debug', 'boot', 'creating EndlesssClient');
  const client = new EndlesssClient({
    // endlesssHttpFetch routes through a Rust reqwest client pinned to
    // HTTP/1.1. tauri-plugin-http's default HTTP/2 client gets 500'd by
    // Endlesss's Cloudflare front-end; HTTP/1.1 succeeds.
    fetch: endlesssHttpFetch,
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
  const engine = createAudioEngine({
    context: audioContext,
    loader,
    logger: (level, message) => log(level, 'audio', message),
  });
  const prefetcher = createPrefetchRing({ loader });
  engine.onStateChange((s) => log('info', 'audio', `engine state → ${s}`));

  const stemDocs = useStemDocsStore();
  const resolveStems = async (
    jamId: JamCouchID,
    riff: RiffDocument,
  ): Promise<ResolvedStem[]> => {
    log('debug', 'audio', `resolveStems jam=${jamId} riff=${riff.riffId}`);
    await unlockAudioContext();
    log('debug', 'audio', `AudioContext resumed → ${audioContext.state}`);
    // Through the stem-document store: the rifff history already fetched
    // these documents to colour its splats, and they never change, so a hop
    // on a rifff that's on screen costs no request.
    const resolved = await stemDocs.resolve(jamId, riff);
    log('info', 'audio', `resolveStems → ${resolved.length} stems`);
    return resolved;
  };

  const hopRecorder = createHopRecorder({
    clock: () => audioContext.currentTime,
    idGen: () => crypto.randomUUID(),
  });
  initPerformanceStore({
    engine,
    prefetcher,
    resolveStems,
    recorder: hopRecorder,
    peekBuffer: (stemId) => loader.peek(stemId),
  });
  log('info', 'boot', 'performance store initialized');

  const sequencesRoot = await join(appData, 'sequences');
  const sequenceStorage = createSequenceStorage({
    fs: tauriFsAdapter(),
    root: sequencesRoot,
  });
  // Through the rifff-document store: a replay's rifffs are fetched once, not
  // once per hop, and the editor and the jam pages share them.
  const riffDocs = useRiffDocsStore();
  const resolveRiff = async (jamId: JamCouchID, riffId: RiffCouchID) => {
    const riff = await riffDocs.fetch(jamId, riffId);
    if (!riff) throw new Error(`Rifff not found: ${riffId}`);
    const stems = await resolveStems(jamId, riff);
    return { riff, stems };
  };
  const hopPlayer = createHopPlayer({
    engine,
    resolveRiff,
    clock: () => audioContext.currentTime,
    scheduler: {
      schedule(delayMs, fn) {
        const id = window.setTimeout(fn, delayMs);
        return () => window.clearTimeout(id);
      },
    },
  });
  initRecorderStore({
    recorder: hopRecorder,
    storage: sequenceStorage,
    player: hopPlayer,
    // "20260919 <jam> hoppp": the first rifff's day, so the hop can be found
    // again in Endlesss or LORE. The rifff was just played, so it's held.
    nameTake: async (seq) => {
      const first = await riffDocs.fetch(seq.jamId, seq.hops[0]!.riffId);
      const jam = useJamsStore().profilesById.get(seq.jamId)?.displayName ?? seq.jamId;
      return hopName(first?.createdAt ?? Date.parse(seq.recordedAt), jam);
    },
  });
  log('info', 'boot', 'recorder store initialized');

  // Export: the take rendered offline through its own engine — sharing the
  // app's decoded stems — and written where the Save dialog says.
  initExportStore({
    chooseFile: async (defaultName) =>
      saveDialog({ defaultPath: defaultName, filters: [{ name: 'WAV audio', extensions: ['wav'] }] }),
    render: (seq) =>
      renderTake(seq, {
        sampleRate: audioContext.sampleRate,
        createContext: (frames, sampleRate) =>
          new OfflineAudioContext(2, frames, sampleRate) as unknown as OfflineContextLike,
        createEngine: (context) => createAudioEngine({ context, loader }),
        resolveRiff,
      }),
    // Raw bytes, not JSON: a take's WAV runs to tens of megabytes.
    write: (path, bytes) =>
      invoke('write_export', bytes, { headers: { 'x-export-path': encodeURIComponent(path) } }),
  });

  initHopEditorStore({
    storage: sequenceStorage,
    riffDocs,
    riffIdsBetween: (jamId, aMs, bMs, limit) => client.getRiffIdsBetween(jamId, aMs, bMs, limit),
  });

  const router = createAppRouter({
    isAuthenticated: () => session.isAuthenticated,
    routes: [
      { path: '/public', name: 'public-jams', component: PublicJamsView },
      { path: '/mine', name: 'my-jams', component: MyJamsView },
      { path: '/hops', name: 'hops', component: HopsView },
      { path: '/settings', name: 'settings', component: SettingsView },
      // Hop Recording. The Perform view stands in until Slice B.
      {
        path: '/jams/:jamId',
        name: 'hop-recording',
        component: PerformView,
        meta: { requiresAuth: true },
      },
      // Editing needs a session: a take's rifffs and stems come from Endlesss.
      {
        path: '/hops/:jamId/:id',
        name: 'hop-editing',
        component: HopEditingView,
        meta: { requiresAuth: true },
      },
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