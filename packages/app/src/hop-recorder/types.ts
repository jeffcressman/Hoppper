import type { JamCouchID, RiffCouchID } from '@hoppper/sdk';
import type { HopQuantise } from '../audio/engine.js';

export const HOP_SEQUENCE_SCHEMA_VERSION = 1 as const;

export interface HopEvent {
  tSec: number;
  riffId: RiffCouchID;
  jamId: JamCouchID;
  transitionMs: number;
  /**
   * The grid this hop was held to live, if quantised entry was on. `tSec` is
   * when the hop was made (once its rifff had loaded); replay holds it to the
   * same grid, so it enters on the beat it entered on live. Absent means
   * unquantised — and in every sequence saved before this field existed.
   */
  quantise?: HopQuantise;
}

/** The mixer moves a take can carry: a track's fader, mute and solo. */
export type AutomationParam = 'volume' | 'mute' | 'solo';
export const AUTOMATION_PARAMS: readonly AutomationParam[] = ['volume', 'mute', 'solo'];

/**
 * A point on an automation line, at `tSec` on the take's timeline (its first
 * rifff arrives at 0). `value` is 0..1 for volume, 0 or 1 for mute and solo.
 */
export interface AutomationPoint {
  tSec: number;
  value: number;
}

/** One track's automation, points in time order. */
export type TrackAutomation = Record<AutomationParam, AutomationPoint[]>;

export interface HopSequence {
  schemaVersion: typeof HOP_SEQUENCE_SCHEMA_VERSION;
  id: string;
  title: string;
  jamId: JamCouchID;
  recordedAt: string;
  durationSec: number;
  hops: HopEvent[];
  /**
   * The mixer moves recorded with the take, one entry per track slot (eight).
   * Absent on takes recorded before automation, which play at each rifff's
   * own mix.
   */
  automation?: TrackAutomation[];
}

export class SequenceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SequenceParseError';
  }
}

export function serializeSequence(seq: HopSequence): string {
  const canonical = {
    schemaVersion: seq.schemaVersion,
    id: seq.id,
    title: seq.title,
    jamId: seq.jamId,
    recordedAt: seq.recordedAt,
    durationSec: seq.durationSec,
    hops: seq.hops.map((h) => ({
      tSec: h.tSec,
      riffId: h.riffId,
      jamId: h.jamId,
      transitionMs: h.transitionMs,
      ...(h.quantise === undefined ? {} : { quantise: h.quantise }),
    })),
    ...(seq.automation === undefined
      ? {}
      : {
          automation: seq.automation.map((track) => ({
            volume: track.volume.map(({ tSec, value }) => ({ tSec, value })),
            mute: track.mute.map(({ tSec, value }) => ({ tSec, value })),
            solo: track.solo.map(({ tSec, value }) => ({ tSec, value })),
          })),
        }),
  };
  return JSON.stringify(canonical, null, 2);
}

export function parseSequence(json: string): HopSequence {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new SequenceParseError(
      `Malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (raw === null || typeof raw !== 'object') {
    throw new SequenceParseError('Sequence must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;

  if (!('schemaVersion' in obj)) {
    throw new SequenceParseError('Missing required field: schemaVersion');
  }
  if (obj.schemaVersion !== HOP_SEQUENCE_SCHEMA_VERSION) {
    throw new SequenceParseError(
      `Unsupported schemaVersion: ${String(obj.schemaVersion)} (expected ${HOP_SEQUENCE_SCHEMA_VERSION})`,
    );
  }

  const requireString = (key: string): string => {
    const v = obj[key];
    if (typeof v !== 'string') {
      throw new SequenceParseError(
        `Field "${key}" must be a string, got ${typeof v}`,
      );
    }
    return v;
  };
  const requireNumber = (key: string): number => {
    const v = obj[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new SequenceParseError(
        `Field "${key}" must be a finite number, got ${typeof v}`,
      );
    }
    return v;
  };

  const id = requireString('id');
  const title = requireString('title');
  const jamId = requireString('jamId');
  const recordedAt = requireString('recordedAt');
  const durationSec = requireNumber('durationSec');

  if (!Array.isArray(obj.hops)) {
    throw new SequenceParseError('Field "hops" must be an array');
  }

  const hops: HopEvent[] = obj.hops.map((h, i) => parseHop(h, i));
  const automation = obj.automation === undefined ? undefined : parseAutomation(obj.automation);

  return {
    schemaVersion: HOP_SEQUENCE_SCHEMA_VERSION,
    id,
    title,
    jamId,
    recordedAt,
    durationSec,
    hops,
    ...(automation === undefined ? {} : { automation }),
  };
}

const TRACK_COUNT = 8;

function parseAutomation(raw: unknown): TrackAutomation[] {
  if (!Array.isArray(raw) || raw.length !== TRACK_COUNT) {
    throw new SequenceParseError(`Field "automation" must be an array of ${TRACK_COUNT} tracks`);
  }
  return raw.map((track, i) => {
    if (track === null || typeof track !== 'object') {
      throw new SequenceParseError(`automation[${i}] must be an object`);
    }
    const t = track as Record<string, unknown>;
    const points = (param: AutomationParam): AutomationPoint[] => {
      const list = t[param] ?? [];
      if (!Array.isArray(list)) throw new SequenceParseError(`automation[${i}].${param} must be an array`);
      return list.map((p, j) => {
        const pt = p as Record<string, unknown> | null;
        if (!pt || typeof pt.tSec !== 'number' || !Number.isFinite(pt.tSec) || typeof pt.value !== 'number' || !Number.isFinite(pt.value)) {
          throw new SequenceParseError(`automation[${i}].${param}[${j}] must have a finite tSec and value`);
        }
        return { tSec: pt.tSec, value: pt.value };
      });
    };
    return { volume: points('volume'), mute: points('mute'), solo: points('solo') };
  });
}

function parseHop(raw: unknown, index: number): HopEvent {
  if (raw === null || typeof raw !== 'object') {
    throw new SequenceParseError(`hops[${index}] must be an object`);
  }
  const h = raw as Record<string, unknown>;
  const want = (key: string, type: 'string' | 'number'): unknown => {
    const v = h[key];
    if (typeof v !== type || (type === 'number' && !Number.isFinite(v as number))) {
      throw new SequenceParseError(
        `hops[${index}].${key} must be a ${type === 'number' ? 'finite number' : type}`,
      );
    }
    return v;
  };
  const hop: HopEvent = {
    tSec: want('tSec', 'number') as number,
    riffId: want('riffId', 'string') as RiffCouchID,
    jamId: want('jamId', 'string') as JamCouchID,
    transitionMs: want('transitionMs', 'number') as number,
  };
  if (h.quantise !== undefined) {
    if (h.quantise !== 'beat' && h.quantise !== 'bar') {
      throw new SequenceParseError(
        `hops[${index}].quantise must be "beat" or "bar", got ${JSON.stringify(h.quantise)}`,
      );
    }
    hop.quantise = h.quantise;
  }
  return hop;
}
