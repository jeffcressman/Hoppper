import type { JamCouchID, ResolvedStem, RiffDocument } from '@hoppper/sdk';
import type { StemLoader } from './stem-loader.js';

export interface RiffWindowItem {
  riff: RiffDocument;
  stems: ResolvedStem[];
}

export interface RiffPrefetcher {
  /**
   * Replace the prefetch window. Any in-flight decode that has not yet
   * started is cancelled; loads already issued continue but produce no
   * follow-on work.
   */
  setWindow(jamId: JamCouchID, items: ReadonlyArray<RiffWindowItem>): void;
  /** Stop all further prefetch work. */
  cancel(): void;
}

export interface RiffPrefetcherOptions {
  loader: StemLoader;
}

export function createPrefetchRing(opts: RiffPrefetcherOptions): RiffPrefetcher {
  const { loader } = opts;
  let epoch = 0;

  async function run(
    myEpoch: number,
    jamId: JamCouchID,
    items: ReadonlyArray<RiffWindowItem>,
  ): Promise<void> {
    for (const item of items) {
      for (const stem of item.stems) {
        if (myEpoch !== epoch) return;
        try {
          await loader.load(stem, jamId);
        } catch {
          // Decode failures don't abort the window — the audio engine will
          // surface 'not-ready' for whatever's still missing when the user
          // tries to hop.
        }
      }
    }
  }

  return {
    setWindow(jamId, items) {
      const myEpoch = ++epoch;
      void run(myEpoch, jamId, items);
    },
    cancel() {
      epoch++;
    },
  };
}
