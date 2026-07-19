import type { JamCouchID } from '@hoppper/sdk';
import {
  HOP_SEQUENCE_SCHEMA_VERSION,
  type HopEvent,
  type HopSequence,
} from './types.js';

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

export interface HopRecorder {
  readonly isRecording: boolean;
  start(opts: StartOptions): void;
  recordHop(event: Omit<HopEvent, 'tSec'>): void;
  stop(): HopSequence;
}

interface ActiveSession {
  id: string;
  jamId: JamCouchID;
  title: string;
  recordedAt: string;
  t0: number;
  hops: HopEvent[];
}

export function createHopRecorder(opts: HopRecorderOptions): HopRecorder {
  const { clock, idGen } = opts;
  const nowDate = opts.now ?? (() => new Date());

  let session: ActiveSession | null = null;

  return {
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
        t0: clock(),
        hops: [],
      };
    },

    recordHop(event) {
      if (session === null) return;
      session.hops.push({
        tSec: clock() - session.t0,
        riffId: event.riffId,
        jamId: event.jamId,
        transitionMs: event.transitionMs,
      });
    },

    stop() {
      if (session === null) {
        throw new Error('HopRecorder not recording');
      }
      const durationSec = clock() - session.t0;
      const seq: HopSequence = {
        schemaVersion: HOP_SEQUENCE_SCHEMA_VERSION,
        id: session.id,
        title: session.title,
        jamId: session.jamId,
        recordedAt: session.recordedAt,
        durationSec,
        hops: session.hops,
      };
      session = null;
      return seq;
    },
  };
}
