import type {
  JamCouchID,
  ResolvedStem,
  RiffCouchID,
  RiffDocument,
} from '@hoppper/sdk';
import type { AudioEngine } from '../audio/engine.js';
import type { HopEvent, HopSequence } from './types.js';

export type PlayerState = 'idle' | 'playing';

export type RiffResolver = (
  jamId: JamCouchID,
  riffId: RiffCouchID,
) => Promise<{ riff: RiffDocument; stems: ResolvedStem[] }>;

export interface PlayerScheduler {
  /** Returns a cancel function. */
  schedule(delayMs: number, fn: () => void): () => void;
}

export interface HopPlayerOptions {
  engine: AudioEngine;
  resolveRiff: RiffResolver;
  /** Seconds-precision clock. Production: `AudioContext.currentTime`. */
  clock: () => number;
  scheduler: PlayerScheduler;
  /** How many riffs ahead to warm. Default 2. */
  warmAhead?: number;
}

export interface HopPlayer {
  readonly state: PlayerState;
  play(sequence: HopSequence): Promise<void>;
  stop(): void;
  /** Subscribe to player state transitions. Returns an unsubscribe fn. */
  onStateChange(fn: (state: PlayerState) => void): () => void;
}

export function createHopPlayer(opts: HopPlayerOptions): HopPlayer {
  const { engine, resolveRiff, clock, scheduler } = opts;
  const warmAhead = opts.warmAhead ?? 2;

  let state: PlayerState = 'idle';
  let cancels: (() => void)[] = [];
  let resolved = new Map<
    RiffCouchID,
    { riff: RiffDocument; stems: ResolvedStem[] }
  >();
  const listeners = new Set<(s: PlayerState) => void>();

  function setState(next: PlayerState): void {
    if (next === state) return;
    state = next;
    for (const l of listeners) l(state);
  }

  function clearAll(): void {
    for (const c of cancels) c();
    cancels = [];
  }

  async function warmHop(jamId: JamCouchID, ev: HopEvent): Promise<void> {
    let entry = resolved.get(ev.riffId);
    if (!entry) {
      entry = await resolveRiff(jamId, ev.riffId);
      resolved.set(ev.riffId, entry);
    }
    await engine.warmRiff(jamId, entry.riff, entry.stems);
  }

  function scheduleHop(seq: HopSequence, index: number, t0: number): void {
    const ev = seq.hops[index];
    const desiredAt = t0 + ev.tSec;
    const delayMs = Math.max(0, (desiredAt - clock()) * 1000);
    const cancel = scheduler.schedule(delayMs, () => {
      const entry = resolved.get(ev.riffId);
      if (!entry) {
        // The warm step should have populated it; defensive fallback.
        return;
      }
      void engine.hopTo(ev.jamId, entry.riff, entry.stems, {
        crossfadeMs: ev.transitionMs,
      });

      // Schedule the next hop, or the final stop at durationSec.
      if (index + 1 < seq.hops.length) {
        scheduleHop(seq, index + 1, t0);
        // Warm one further ahead than we already have.
        const aheadIdx = index + 1 + warmAhead;
        if (aheadIdx < seq.hops.length) {
          void warmHop(seq.jamId, seq.hops[aheadIdx]);
        }
      } else {
        scheduleFinalStop(seq, t0);
      }
    });
    cancels.push(cancel);
  }

  function scheduleFinalStop(seq: HopSequence, t0: number): void {
    const endAt = t0 + seq.durationSec;
    const delayMs = Math.max(0, (endAt - clock()) * 1000);
    const cancel = scheduler.schedule(delayMs, () => {
      engine.stop();
      setState('idle');
    });
    cancels.push(cancel);
  }

  return {
    get state() {
      return state;
    },

    async play(seq) {
      if (state === 'playing') {
        throw new Error('HopPlayer already playing');
      }
      if (seq.hops.length === 0) {
        throw new Error('Cannot play sequence with no hops');
      }
      setState('playing');
      resolved = new Map();

      // Warm the first riff plus the next `warmAhead` riffs.
      const initialWarm = seq.hops.slice(0, warmAhead + 1);
      await Promise.all(initialWarm.map((ev) => warmHop(seq.jamId, ev)));

      const t0 = clock();
      scheduleHop(seq, 0, t0);
    },

    stop() {
      clearAll();
      engine.stop();
      setState('idle');
    },

    onStateChange(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
