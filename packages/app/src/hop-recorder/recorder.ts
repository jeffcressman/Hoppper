import type { JamCouchID } from '@hoppper/sdk';
import {
  HOP_SEQUENCE_SCHEMA_VERSION,
  type AutomationParam,
  type HopEvent,
  type HopSequence,
  type TrackAutomation,
} from './types.js';

/** The mixer as it stands: per track, its fader, mute and solo. */
export interface MixSnapshot {
  volume: number[];
  mute: boolean[];
  solo: boolean[];
}

export interface MixChange {
  slot: number;
  param: AutomationParam;
  value: number;
}

/** A fader drag makes a point this often at most; closer moves replace the last. */
const MIN_POINT_GAP_SEC = 0.03;

export interface HopRecorderOptions {
  clock: () => number;
  idGen: () => string;
  /** Defaults to `() => new Date().toISOString()`. Injectable for tests. */
  now?: () => Date;
}

export interface StartOptions {
  jamId: JamCouchID;
  title?: string;
}

/**
 * `armed` is between Record and the first hop: a session is open and the next
 * click will be captured, but the take's timeline hasn't begun.
 */
export type RecorderState = 'idle' | 'armed' | 'recording';

export interface HopRecorder {
  readonly state: RecorderState;
  /** True while armed or recording — i.e. the next hop will be captured. */
  readonly isRecording: boolean;
  start(opts: StartOptions): void;
  /**
   * `atSec` is when the hop happened on the recorder's clock — the moment
   * playback of the rifff began. Defaults to now.
   */
  recordHop(event: Omit<HopEvent, 'tSec'>, atSec?: number): void;
  /**
   * The mixer at the take's first rifff: every track's lines start from it.
   * Called once the first hop is in; before that there's no timeline.
   */
  startMix(snapshot: MixSnapshot): void;
  /** A mixer move, at `atSec` on the recorder's clock (default now). Ignored before the first hop. */
  recordMix(change: MixChange, atSec?: number): void;
  /** Ends the session. A take stopped while still armed has no hops. */
  stop(): HopSequence;
  onStateChange(fn: (s: RecorderState) => void): () => void;
}

interface ActiveSession {
  id: string;
  jamId: JamCouchID;
  title: string;
  recordedAt: string;
  /** Clock at the first hop. Null while armed. */
  t0: number | null;
  hops: HopEvent[];
  automation: TrackAutomation[] | null;
}

export function createHopRecorder(opts: HopRecorderOptions): HopRecorder {
  const { clock, idGen } = opts;
  const nowDate = opts.now ?? (() => new Date());

  let session: ActiveSession | null = null;
  const listeners = new Set<(s: RecorderState) => void>();

  function currentState(): RecorderState {
    if (session === null) return 'idle';
    return session.t0 === null ? 'armed' : 'recording';
  }

  function emit(): void {
    const s = currentState();
    for (const l of listeners) l(s);
  }

  return {
    get state() {
      return currentState();
    },
    get isRecording() {
      return session !== null;
    },

    start(startOpts) {
      if (session !== null) {
        throw new Error('HopRecorder already recording');
      }
      const recordedAt = nowDate().toISOString();
      session = {
        id: idGen(),
        jamId: startOpts.jamId,
        title: startOpts.title ?? recordedAt,
        recordedAt,
        t0: null,
        hops: [],
        automation: null,
      };
      emit();
    },

    recordHop(event, atSec) {
      if (session === null) return;
      // The take begins at its first hop, which is always at 0.
      const now = atSec ?? clock();
      const firstHop = session.t0 === null;
      const t0 = session.t0 ?? now;
      session.t0 = t0;
      session.hops.push({
        tSec: now - t0,
        riffId: event.riffId,
        jamId: event.jamId,
        transitionMs: event.transitionMs,
        ...(event.quantise === undefined ? {} : { quantise: event.quantise }),
      });
      if (firstHop) emit();
    },

    startMix(snapshot) {
      if (session === null || session.t0 === null) return;
      session.automation = snapshot.volume.map((volume, slot) => ({
        volume: [{ tSec: 0, value: volume }],
        mute: [{ tSec: 0, value: snapshot.mute[slot] ? 1 : 0 }],
        solo: [{ tSec: 0, value: snapshot.solo[slot] ? 1 : 0 }],
      }));
    },

    recordMix(change, atSec) {
      const track = session?.automation?.[change.slot];
      if (!session || session.t0 === null || !track) return;
      const tSec = Math.max(0, (atSec ?? clock()) - session.t0);
      const points = track[change.param];
      const last = points.at(-1);
      if (last && tSec - last.tSec < MIN_POINT_GAP_SEC && points.length > 1) {
        points[points.length - 1] = { tSec, value: change.value };
      } else {
        points.push({ tSec, value: change.value });
      }
    },

    stop() {
      if (session === null) {
        throw new Error('HopRecorder not recording');
      }
      const durationSec = session.t0 === null ? 0 : clock() - session.t0;
      const seq: HopSequence = {
        schemaVersion: HOP_SEQUENCE_SCHEMA_VERSION,
        id: session.id,
        title: session.title,
        jamId: session.jamId,
        recordedAt: session.recordedAt,
        durationSec,
        hops: session.hops,
        ...(session.automation ? { automation: session.automation } : {}),
      };
      session = null;
      emit();
      return seq;
    },

    onStateChange(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
