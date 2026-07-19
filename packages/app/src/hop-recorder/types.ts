import type { JamCouchID, RiffCouchID } from '@hoppper/sdk';

export const HOP_SEQUENCE_SCHEMA_VERSION = 1 as const;

export interface HopEvent {
  tSec: number;
  riffId: RiffCouchID;
  jamId: JamCouchID;
  transitionMs: number;
}

export interface HopSequence {
  schemaVersion: typeof HOP_SEQUENCE_SCHEMA_VERSION;
  id: string;
  title: string;
  jamId: JamCouchID;
  recordedAt: string;
  durationSec: number;
  hops: HopEvent[];
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
    })),
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

  return {
    schemaVersion: HOP_SEQUENCE_SCHEMA_VERSION,
    id,
    title,
    jamId,
    recordedAt,
    durationSec,
    hops,
  };
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
  return {
    tSec: want('tSec', 'number') as number,
    riffId: want('riffId', 'string') as RiffCouchID,
    jamId: want('jamId', 'string') as JamCouchID,
    transitionMs: want('transitionMs', 'number') as number,
  };
}
