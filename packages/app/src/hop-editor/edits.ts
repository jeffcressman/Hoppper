import type { RiffCouchID } from '@hoppper/sdk';
import type { HopEvent, HopSequence } from '../hop-recorder/types';

// The hop editor's operations, each a pure function from one take to the
// next, so undo is a stack of takes. Rules signed off 2026-09-18:
// docs/phases/phase-8-redesign-and-editor.md → "Slice C".
//
// Everything here works in *arrival* times: when a hop is heard, which is
// when its crossfade ends — later than its `tSec`, which is when the engine
// acted on it (and later still for a quantised hop, which replay holds to the
// next beat or bar). Times are seconds on the take's grid, which starts with
// its first rifff at 0, as replay's does.

export type Snap = 'beat' | 'bar' | 'off';

/** A rifff's grid: its beat and bar in seconds. */
export interface RiffGrid {
  beatSec: number;
  barSec: number;
}
export type GridOf = (riffId: RiffCouchID) => RiffGrid | undefined;

export interface Segment {
  index: number;
  riffId: RiffCouchID;
  startSec: number;
  endSec: number;
}

/** The smallest gap left between two hop points when snapping is off. */
const MIN_GAP_SEC = 0.05;

const crossfadeSec = (h: HopEvent) => Math.max(0, h.transitionMs) / 1000;

/** When hop `index` is heard. Replay holds a quantised hop the same way (engine `computeHop`). */
export function arrivalSec(h: HopEvent, index: number, gridOf: GridOf): number {
  if (index === 0) return h.tSec;
  const unheld = h.tSec + crossfadeSec(h);
  const grid = h.quantise ? gridOf(h.riffId) : undefined;
  const unit = h.quantise === 'beat' ? grid?.beatSec : h.quantise === 'bar' ? grid?.barSec : undefined;
  if (!unit || !(unit > 0)) return unheld;
  return Math.ceil(unheld / unit - 1e-9) * unit;
}

/** A hop that arrives exactly at `at`, with nothing left for replay to hold. */
function arrivingAt(h: HopEvent, at: number): HopEvent {
  const { quantise: _held, ...rest } = h;
  return { ...rest, tSec: at - crossfadeSec(h) };
}

export function segmentsOf(seq: HopSequence, gridOf: GridOf): Segment[] {
  const starts = seq.hops.map((h, i) => arrivalSec(h, i, gridOf));
  return seq.hops.map((h, i) => ({
    index: i,
    riffId: h.riffId,
    startSec: starts[i]!,
    endSec: starts[i + 1] ?? seq.durationSec,
  }));
}

/**
 * Drag hop point `index` to arrive at `toSec`. Only the rifffs either side
 * change — the incoming one starts earlier or later — and every other hop
 * keeps its time. Snaps to the incoming rifff's beat or bar on the take's
 * grid, and stays at least one snap (or a sliver, unsnapped) clear of its
 * neighbours.
 */
export function moveHop(seq: HopSequence, index: number, toSec: number, snap: Snap, gridOf: GridOf): HopSequence {
  const h = seq.hops[index];
  if (index < 1 || !h || !Number.isFinite(toSec)) return seq;
  const segs = segmentsOf(seq, gridOf);
  const grid = gridOf(h.riffId);
  const unit = snap === 'beat' ? grid?.beatSec : snap === 'bar' ? grid?.barSec : undefined;
  const gap = unit && unit > 0 ? unit : MIN_GAP_SEC;
  let lo = segs[index - 1]!.startSec + gap;
  let hi = segs[index]!.endSec - gap;
  let at = toSec;
  if (unit && unit > 0) {
    lo = Math.ceil(lo / unit - 1e-9) * unit;
    hi = Math.floor(hi / unit + 1e-9) * unit;
    at = Math.round(toSec / unit) * unit;
  }
  if (lo > hi) return seq;
  at = Math.min(hi, Math.max(lo, at));
  const hops = seq.hops.slice();
  hops[index] = arrivingAt(h, at);
  return { ...seq, hops };
}

/** Every hop from `from` on arrives `bySec` later (earlier, if negative). */
function shiftFrom(seq: HopSequence, hops: HopEvent[], from: number, bySec: number, gridOf: GridOf): HopEvent[] {
  return hops.map((h, i) => (i < from ? h : arrivingAt(h, arrivalSec(h, i, gridOf) + bySec)));
}

/**
 * Delete hop point `index`: the rifff it brought in goes, and every later hop
 * point moves left by that rifff's length, so the take closes up.
 */
export function deleteHop(seq: HopSequence, index: number, gridOf: GridOf): HopSequence {
  if (index < 1 || index >= seq.hops.length) return seq;
  const seg = segmentsOf(seq, gridOf)[index]!;
  const length = seg.endSec - seg.startSec;
  // Work out later arrivals against the take as it was, then drop the hop.
  const shifted = shiftFrom(seq, seq.hops, index + 1, -length, gridOf);
  shifted.splice(index, 1);
  return { ...seq, hops: shifted, durationSec: seq.durationSec - length };
}

/**
 * Put `riffId` in at hop point `index`, for `lengthSec`; the rifff that was
 * there and every later one move right. It comes in with that hop point's
 * crossfade.
 */
export function insertRiff(
  seq: HopSequence,
  index: number,
  riffId: RiffCouchID,
  lengthSec: number,
  gridOf: GridOf,
): HopSequence {
  if (index < 1 || index > seq.hops.length || !(lengthSec > 0)) return seq;
  const at = index < seq.hops.length ? segmentsOf(seq, gridOf)[index]!.startSec : seq.durationSec;
  const template = seq.hops[index] ?? seq.hops[index - 1]!;
  const added: HopEvent = arrivingAt({ ...template, riffId, jamId: seq.jamId }, at);
  const shifted = shiftFrom(seq, seq.hops, index, lengthSec, gridOf);
  shifted.splice(index, 0, added);
  return { ...seq, hops: shifted, durationSec: seq.durationSec + lengthSec };
}

/** Another copy of rifff `index`, right after it, for `lengthSec`. */
export function duplicateSegment(
  seq: HopSequence,
  index: number,
  lengthSec: number,
  gridOf: GridOf,
): HopSequence {
  const h = seq.hops[index];
  if (!h) return seq;
  return insertRiff(seq, index + 1, h.riffId, lengthSec, gridOf);
}

/**
 * The rifffs a hop skipped: those committed to the jam between the two, in
 * commit order whichever way the hop went. `history` is the jam's rifffs in
 * commit order.
 */
export function skippedBetween(history: RiffCouchID[], from: RiffCouchID, to: RiffCouchID): RiffCouchID[] {
  const a = history.indexOf(from);
  const b = history.indexOf(to);
  if (a === -1 || b === -1) return [];
  return history.slice(Math.min(a, b) + 1, Math.max(a, b));
}
