import type { AutomationParam, AutomationPoint, TrackAutomation } from '../hop-recorder/types';

// A take's automation: per track, lines for volume (ramps between points)
// and mute and solo (steps). Pure functions, like the hop edits, so each
// edit is a new take and undo is a stack of them. Times are the take's.

export const TRACKS = 8;
const DEFAULTS: Record<AutomationParam, number> = { volume: 1, mute: 0, solo: 0 };

export function blankAutomation(): TrackAutomation[] {
  return Array.from({ length: TRACKS }, () => ({ volume: [], mute: [], solo: [] }));
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const isStep = (param: AutomationParam) => param !== 'volume';

/**
 * A line's value at `t`: volume ramps straight between points, mute and solo
 * step. Before the first point the line holds its first value, after the last
 * its last; with no points, the track's natural state.
 */
export function valueAt(points: AutomationPoint[], t: number, param: AutomationParam): number {
  if (points.length === 0) return DEFAULTS[param];
  if (t < points[0]!.tSec) return points[0]!.value;
  // The last point at or before t (the later of any sharing a time).
  let i = 0;
  while (i + 1 < points.length && points[i + 1]!.tSec <= t) i++;
  const p = points[i]!;
  const next = points[i + 1];
  if (isStep(param) || !next) return p.value;
  return p.value + ((next.value - p.value) * (t - p.tSec)) / (next.tSec - p.tSec);
}

/** Whether track `slot` is heard at `t`: not muted, and soloed if anything is. */
function audibleAt(tracks: TrackAutomation[], slot: number, t: number): boolean {
  if (valueAt(tracks[slot]!.mute, t, 'mute') >= 0.5) return false;
  const anySolo = tracks.some((tr) => valueAt(tr.solo, t, 'solo') >= 0.5);
  return !anySolo || valueAt(tracks[slot]!.solo, t, 'solo') >= 0.5;
}

/** The level track `slot` is heard at, at `t`. */
export function levelAt(tracks: TrackAutomation[], slot: number, t: number): number {
  return audibleAt(tracks, slot, t) ? valueAt(tracks[slot]!.volume, t, 'volume') : 0;
}

/** A stretch of a track's level: from `from` at `tSec`, straight to `to` at the next stretch. */
export interface CurveSegment {
  tSec: number;
  from: number;
  to: number;
}

/**
 * Track `slot`'s heard level as straight stretches the engine can schedule —
 * a ramp for each stretch between changes, a step at each mute or solo
 * change (any track's solo matters). The last stretch holds.
 */
export function levelCurve(tracks: TrackAutomation[], slot: number): CurveSegment[] {
  const times = new Set<number>([0]);
  for (const p of tracks[slot]!.volume) times.add(p.tSec);
  for (const p of tracks[slot]!.mute) times.add(p.tSec);
  for (const tr of tracks) for (const p of tr.solo) times.add(p.tSec);
  const sorted = [...times].filter((t) => t >= 0).sort((a, b) => a - b);
  return sorted.map((t, i) => {
    const next = sorted[i + 1];
    const from = levelAt(tracks, slot, t);
    // Just before the next change: where this stretch's ramp ends.
    const to = next === undefined ? from : audibleAt(tracks, slot, t) ? valueBefore(tracks[slot]!.volume, next) : 0;
    return { tSec: t, from, to };
  });
}

/** Every track's level curve, for the engine. */
export function automationCurves(tracks: TrackAutomation[]): CurveSegment[][] {
  return Array.from({ length: TRACKS }, (_, slot) => (tracks[slot] ? levelCurve(tracks, slot) : [{ tSec: 0, from: 1, to: 1 }]));
}

/** Volume approaching `t` from before — ignoring a jump exactly at `t`. */
function valueBefore(points: AutomationPoint[], t: number): number {
  const before = points.filter((p) => p.tSec < t);
  const after = points.filter((p) => p.tSec >= t);
  if (before.length === 0) return valueAt(points, t, 'volume');
  const last = before.at(-1)!;
  const next = after[0];
  if (!next) return last.value;
  return last.value + ((next.value - last.value) * (t - last.tSec)) / (next.tSec - last.tSec);
}

// ── Editing points ────────────────────────────────────────────────────────

export function addPoint(points: AutomationPoint[], tSec: number, value: number): AutomationPoint[] {
  const p = { tSec: Math.max(0, tSec), value: clamp01(value) };
  const at = points.findIndex((q) => q.tSec > p.tSec);
  return at === -1 ? [...points, p] : [...points.slice(0, at), p, ...points.slice(at)];
}

/** Move point `index`, kept between its neighbours in time. */
export function movePoint(points: AutomationPoint[], index: number, tSec: number, value: number): AutomationPoint[] {
  if (!points[index]) return points;
  const lo = points[index - 1]?.tSec ?? 0;
  const hi = points[index + 1]?.tSec ?? Infinity;
  const out = points.slice();
  out[index] = { tSec: Math.min(hi, Math.max(lo, tSec)), value: clamp01(value) };
  return out;
}

export function removePoint(points: AutomationPoint[], index: number): AutomationPoint[] {
  return points.filter((_, i) => i !== index);
}

// ── Time edits: automation goes with the music ────────────────────────────

function eachLine(
  tracks: TrackAutomation[] | undefined,
  fn: (points: AutomationPoint[], param: AutomationParam) => AutomationPoint[],
): TrackAutomation[] | undefined {
  if (!tracks) return undefined;
  return tracks.map((tr) => ({
    volume: fn(tr.volume, 'volume'),
    mute: fn(tr.mute, 'mute'),
    solo: fn(tr.solo, 'solo'),
  }));
}

/** Drop repeated points: same time and value as the one before. */
function tidy(points: AutomationPoint[]): AutomationPoint[] {
  return points.filter((p, i) => {
    const prev = points[i - 1];
    return !prev || prev.tSec !== p.tSec || prev.value !== p.value;
  });
}

/**
 * Cut `from`–`to` out of the take: its automation goes, and what came after
 * closes up, carrying on exactly as it was. Either side of the cut keeps its
 * level, meeting at `from`.
 */
export function cutTime(tracks: TrackAutomation[] | undefined, from: number, to: number): TrackAutomation[] | undefined {
  const length = to - from;
  if (!(length > 0)) return tracks;
  return eachLine(tracks, (points, param) => {
    if (points.length === 0) return points;
    const before = points.filter((p) => p.tSec < from);
    const after = points.filter((p) => p.tSec >= to).map((p) => ({ ...p, tSec: p.tSec - length }));
    return tidy([
      ...before,
      { tSec: from, value: valueAt(points, from, param) },
      { tSec: from, value: valueAt(points, to, param) },
      ...after,
    ]);
  });
}

/** Insert `length` of time at `at`: the level there holds across it, and the rest moves along. */
export function insertTime(tracks: TrackAutomation[] | undefined, at: number, length: number): TrackAutomation[] | undefined {
  if (!(length > 0)) return tracks;
  return eachLine(tracks, (points, param) => {
    if (points.length === 0) return points;
    const before = points.filter((p) => p.tSec < at);
    const after = points.filter((p) => p.tSec >= at).map((p) => ({ ...p, tSec: p.tSec + length }));
    const held = valueAt(points, at, param);
    return tidy([...before, { tSec: at, value: held }, { tSec: at + length, value: held }, ...after]);
  });
}

/** The take now ends at `end`: drop what came after, keeping the level there. */
export function trimAfter(tracks: TrackAutomation[] | undefined, end: number): TrackAutomation[] | undefined {
  return eachLine(tracks, (points, param) => {
    if (points.length === 0 || points.at(-1)!.tSec <= end) return points;
    return tidy([...points.filter((p) => p.tSec < end), { tSec: end, value: valueAt(points, end, param) }]);
  });
}
