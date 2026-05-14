import { defineStore } from 'pinia';
import { ref } from 'vue';
import type {
  JamCouchID,
  ResolvedStem,
  RiffCouchID,
  RiffDocument,
  StemCouchID,
} from '@hoppper/sdk';
import type {
  AudioEngine,
  AudioEngineState,
  HopResult,
} from '../audio/engine.js';
import type { RiffPrefetcher } from '../audio/prefetch.js';

// The view needs a way to look up resolved stems for a riff. The SDK has
// getStemUrls(jamId, riff); we accept any compatible function so tests can
// stub the call without touching the real EndlesssClient.
export type StemResolver = (
  jamId: JamCouchID,
  riff: RiffDocument,
) => Promise<ResolvedStem[]>;

export interface PerformanceDeps {
  engine: AudioEngine;
  prefetcher: RiffPrefetcher;
  resolveStems: StemResolver;
}

export function definePerformanceStore(deps: PerformanceDeps) {
  return defineStore('performance', () => {
    const state = ref<AudioEngineState>(deps.engine.state);
    const currentRiffId = ref<RiffCouchID | null>(deps.engine.currentRiffId);
    const missingStems = ref<StemCouchID[]>([]);
    const lastError = ref<string | null>(null);

    deps.engine.onStateChange((s) => {
      state.value = s;
      currentRiffId.value = deps.engine.currentRiffId;
    });

    async function hopTo(jamId: JamCouchID, riff: RiffDocument): Promise<HopResult> {
      lastError.value = null;
      missingStems.value = [];
      let stems: ResolvedStem[];
      try {
        stems = await deps.resolveStems(jamId, riff);
      } catch (err) {
        lastError.value = err instanceof Error ? err.message : String(err);
        return { kind: 'not-ready', missingStemIds: [] };
      }
      // Warm before hopping — if buffers are absent, the hop returns
      // not-ready and the UI shows a busy badge.
      await deps.engine.warmRiff(jamId, riff, stems);
      const result = await deps.engine.hopTo(jamId, riff, stems);
      if (result.kind === 'not-ready') {
        missingStems.value = result.missingStemIds;
      } else {
        currentRiffId.value = result.riffId;
      }
      return result;
    }

    function stop(): void {
      deps.engine.stop();
    }

    async function prefetchWindow(
      jamId: JamCouchID,
      riffs: RiffDocument[],
      centerIndex: number,
      radius = 2,
    ): Promise<void> {
      const start = Math.max(0, centerIndex - radius);
      const end = Math.min(riffs.length, centerIndex + radius + 1);
      const slice = riffs.slice(start, end);
      const items = await Promise.all(
        slice.map(async (r) => ({ riff: r, stems: await deps.resolveStems(jamId, r) })),
      );
      deps.prefetcher.setWindow(jamId, items);
    }

    return { state, currentRiffId, missingStems, lastError, hopTo, stop, prefetchWindow };
  });
}
