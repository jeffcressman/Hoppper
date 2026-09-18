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
  HopQuantise,
  HopResult,
} from '../audio/engine.js';
import type { RiffPrefetcher } from '../audio/prefetch.js';
import type { HopRecorder } from '../hop-recorder/recorder.js';

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
  recorder?: HopRecorder;
  /** Default crossfade duration recorded per click. Defaults to 250. */
  defaultCrossfadeMs?: number;
  /**
   * Which grid quantised entry snaps to when the user turns it on. A beat by
   * default: a bar can mean waiting a couple of seconds, which reads as lag.
   */
  quantiseGrid?: HopQuantise;
}

/**
 * What a click on Hop came to. `cancelled` means the rifff was never played:
 * while it was still loading, a newer click, Stop, or Record (which stops
 * first) came in.
 */
export type PerformanceHopResult = HopResult | { kind: 'cancelled' };

export function definePerformanceStore(deps: PerformanceDeps) {
  return defineStore('performance', () => {
    const state = ref<AudioEngineState>(deps.engine.state);
    const currentRiffId = ref<RiffCouchID | null>(deps.engine.currentRiffId);
    const missingStems = ref<StemCouchID[]>([]);
    const lastError = ref<string | null>(null);
    // Off by default: a hop lands in time either way now, and holding the
    // click back is a deliberate performance choice, not a fix.
    const quantiseEntry = ref(false);
    const quantiseGrid: HopQuantise = deps.quantiseGrid ?? 'beat';

    deps.engine.onStateChange((s) => {
      state.value = s;
    });
    // Every hop, not just idle ↔ playing: replay hops the engine directly,
    // and the state is 'playing' on both sides of a hop.
    deps.engine.onRiffChange((riffId) => {
      currentRiffId.value = riffId;
    });

    // Bumped by every click and by stop(). A hop still loading when it moves
    // on has been overtaken: the latest click wins, so what plays is what the
    // user last asked for rather than whatever finished loading last.
    let latestHop = 0;

    async function hopTo(
      jamId: JamCouchID,
      riff: RiffDocument,
    ): Promise<PerformanceHopResult> {
      lastError.value = null;
      missingStems.value = [];
      const thisHop = ++latestHop;
      let stems: ResolvedStem[];
      try {
        stems = await deps.resolveStems(jamId, riff);
      } catch (err) {
        if (thisHop !== latestHop) return { kind: 'cancelled' };
        lastError.value = err instanceof Error ? err.message : String(err);
        return { kind: 'not-ready', missingStemIds: [] };
      }
      if (thisHop !== latestHop) return { kind: 'cancelled' };
      // Warm before hopping — if buffers are absent, the hop returns
      // not-ready and the UI shows a busy badge.
      await deps.engine.warmRiff(jamId, riff, stems);
      if (thisHop !== latestHop) return { kind: 'cancelled' };
      const quantise = quantiseEntry.value ? quantiseGrid : undefined;
      const result = quantise
        ? await deps.engine.hopTo(jamId, riff, stems, { quantise })
        : await deps.engine.hopTo(jamId, riff, stems);
      if (result.kind === 'not-ready') {
        missingStems.value = result.missingStemIds;
        return result;
      }
      currentRiffId.value = result.riffId;
      // A take holds what was heard: the hop registers when its rifff began
      // playing, after loading, at the engine's own time for it. A click that
      // never played isn't part of it. Replay re-applies `quantise`, so the
      // hop is held to the same beat it was held to live.
      if (deps.recorder?.isRecording) {
        deps.recorder.recordHop(
          {
            riffId: riff.riffId,
            jamId,
            transitionMs: deps.defaultCrossfadeMs ?? 250,
            ...(quantise === undefined ? {} : { quantise }),
          },
          result.atSec,
        );
      }
      return result;
    }

    function stop(): void {
      latestHop++;
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

    return {
      state,
      currentRiffId,
      missingStems,
      lastError,
      quantiseEntry,
      hopTo,
      stop,
      prefetchWindow,
    };
  });
}
