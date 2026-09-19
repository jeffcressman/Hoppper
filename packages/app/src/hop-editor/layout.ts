import type { RiffCouchID } from '@hoppper/sdk';
import type { Segment } from './edits';

// Where everything on the hop editor's timeline goes, in seconds on the
// take's grid — the view scales to pixels. Mirrors the design canvas
// (project resources/Design/Canvas/Main.dc.html) and the editing sketches.

export interface SkippedRifff {
  riffId: RiffCouchID;
  /** How long it's shown for: one loop. */
  lengthSec: number;
}

export interface TimelineSelection {
  /** Selected hop point (≥ 1), or null. */
  point: number | null;
  /** Expanded at the selected point: the rifffs the hop skipped. */
  skipped: SkippedRifff[];
}

export interface TimelineBlock {
  key: string;
  riffId: RiffCouchID;
  /** 1 above, 2 below — two lanes only around a selected hop point. */
  lane: 1 | 2;
  startSec: number;
  endSec: number;
  /** seg: part of the take; ghost: a rifff running on past its hop, dashed; skip: skipped, shown by Expand. */
  kind: 'seg' | 'ghost' | 'skip';
  segIndex?: number;
  skipIndex?: number;
}

export interface TimelinePin {
  key: string;
  num: number;
  atSec: number;
  kind: 'plain' | 'selected' | 'candidate';
  /** The hop this point is, when it can be selected or dragged. */
  hopIndex?: number;
}

export interface TimelineLayout {
  blocks: TimelineBlock[];
  pins: TimelinePin[];
  split: boolean;
  endSec: number;
}

export function timelineLayout(
  segments: Segment[],
  selection: TimelineSelection,
  loopSecOf: (riffId: RiffCouchID) => number,
): TimelineLayout {
  const k = selection.point !== null && selection.point >= 1 && selection.point < segments.length ? selection.point : null;
  const blocks: TimelineBlock[] = [];
  const pins: TimelinePin[] = [];

  if (k === null) {
    for (const s of segments) {
      blocks.push({ key: `seg-${s.index}`, riffId: s.riffId, lane: 1, startSec: s.startSec, endSec: s.endSec, kind: 'seg', segIndex: s.index });
      if (s.index > 0) pins.push({ key: `pin-${s.index}`, num: s.index, atSec: s.startSec, kind: 'plain', hopIndex: s.index });
    }
    return { blocks, pins, split: false, endSec: segments.at(-1)?.endSec ?? 0 };
  }

  const at = segments[k]!.startSec;
  const skipped = selection.skipped;
  const m = skipped.length;
  const shift = skipped.reduce((sum, s) => sum + s.lengthSec, 0);

  for (const s of segments) {
    const after = s.index >= k;
    const move = after ? shift : 0;
    blocks.push({
      key: `seg-${s.index}`,
      riffId: s.riffId,
      lane: after ? 2 : 1,
      startSec: s.startSec + move,
      endSec: s.endSec + move,
      kind: 'seg',
      segIndex: s.index,
    });
  }

  if (m === 0) {
    // Each side of the hop, running on: the outgoing rifff past the point,
    // and the incoming one's run-in before it.
    const out = segments[k - 1]!.riffId;
    const inc = segments[k]!.riffId;
    blocks.push({ key: 'ghost-out', riffId: out, lane: 1, startSec: at, endSec: at + loopSecOf(out), kind: 'ghost' });
    blocks.push({ key: 'ghost-in', riffId: inc, lane: 2, startSec: Math.max(0, at - loopSecOf(inc)), endSec: at, kind: 'ghost' });
  } else {
    let from = at;
    skipped.forEach((s, i) => {
      blocks.push({ key: `skip-${i}`, riffId: s.riffId, lane: 1, startSec: from, endSec: from + s.lengthSec, kind: 'skip', skipIndex: i });
      from += s.lengthSec;
    });
  }

  for (let j = 1; j < segments.length; j++) {
    const start = segments[j]!.startSec;
    if (j < k) {
      pins.push({ key: `pin-${j}`, num: j, atSec: start, kind: 'plain', hopIndex: j });
    } else if (j === k) {
      pins.push({ key: `pin-${j}`, num: j, atSec: start, kind: 'selected', hopIndex: j });
      if (m > 0) {
        let from = start;
        for (let i = 0; i < m - 1; i++) {
          from += skipped[i]!.lengthSec;
          pins.push({ key: `cand-${i}`, num: k + i + 1, atSec: from, kind: 'candidate' });
        }
        // Where the incoming rifff now comes in, after the skipped ones.
        pins.push({ key: 'pin-incoming', num: k + m, atSec: start + shift, kind: 'plain' });
      }
    } else {
      pins.push({ key: `pin-${j}`, num: j + m, atSec: start + shift, kind: 'plain', hopIndex: j });
    }
  }

  const endSec = Math.max(...blocks.map((b) => b.endSec));
  return { blocks, pins, split: true, endSec };
}

// ── Vertical geometry ────────────────────────────────────────────────────

/** Where the first lane starts, below the ruler, hop points and labels. */
export const LANE_TOP = 82;
/** Eight tracks at 16 px: the smallest a lane gets before the timeline scrolls. */
export const MIN_LANE_H = 128;
/** Between the two lanes, room for the hop lines to cross. */
const LANE_GAP = 22;
/** The second lane's labels sit below it. */
const LABEL_H = 24;
/** Room for the horizontal scrollbar and a little air. */
const FOOT = 16;

export interface LaneGeometry {
  laneH: number;
  lane1Y: number;
  lane2Y: number;
  /** Top of the labels under the second lane. */
  label2Y: number;
  /** Everything's height: at least what was available, unless lanes hit their minimum. */
  height: number;
}

/**
 * Lanes fill the timeline's height: two share it around a selected hop
 * point, one takes it all. `availablePx` is the timeline's inner height;
 * `trackZoom` (≥ 1) makes them taller than that, to scroll.
 */
export function laneGeometry(availablePx: number, split: boolean, trackZoom = 1): LaneGeometry {
  const room = availablePx - LANE_TOP - FOOT - (split ? LANE_GAP + LABEL_H : 0);
  // Zoomed taller than the view, the timeline scrolls; never shorter than it fits.
  const fitted = Math.max(MIN_LANE_H, Math.floor(split ? room / 2 : room));
  const laneH = Math.round(fitted * Math.max(1, trackZoom));
  const lane1Y = LANE_TOP;
  const lane2Y = lane1Y + laneH + LANE_GAP;
  const label2Y = lane2Y + laneH + 6;
  const height = split ? label2Y + LABEL_H - 6 + FOOT : lane1Y + laneH + FOOT;
  return { laneH, lane1Y, lane2Y, label2Y, height };
}
