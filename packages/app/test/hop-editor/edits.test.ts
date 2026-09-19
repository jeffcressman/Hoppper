import { describe, it, expect } from 'vitest';
import type { JamCouchID, RiffCouchID } from '@hoppper/sdk';
import type { HopEvent, HopSequence } from '../../src/hop-recorder/types';
import {
  arrivalSec,
  deleteHop,
  duplicateSegment,
  insertRiff,
  moveHop,
  segmentsOf,
  skippedBetween,
  type GridOf,
} from '../../src/hop-editor/edits';

const JAM = 'band1' as JamCouchID;
const hop = (tSec: number, riffId: string, extra: Partial<HopEvent> = {}): HopEvent => ({
  tSec,
  riffId: riffId as RiffCouchID,
  jamId: JAM,
  transitionMs: 250,
  ...extra,
});

// Rifffs A, B, C arriving at 0, 8 and 16 s (each crossfade starts 250 ms
// before), the take ending at 24 s.
function take(hops = [hop(0, 'A'), hop(7.75, 'B'), hop(15.75, 'C')], durationSec = 24): HopSequence {
  return { schemaVersion: 1, id: 't', title: 'Take', jamId: JAM, recordedAt: '', durationSec, hops };
}

// 120 BPM throughout: half-second beats, 2 s bars.
const grid: GridOf = () => ({ beatSec: 0.5, barSec: 2 });

const arrivals = (seq: HopSequence) => seq.hops.map((h, i) => arrivalSec(h, i, grid));

describe('arrivalSec — where a hop is heard', () => {
  it('is the take’s start for the first rifff', () => {
    expect(arrivalSec(hop(0, 'A'), 0, grid)).toBe(0);
  });

  it('is the end of the crossfade for a hop', () => {
    expect(arrivalSec(hop(7.75, 'B'), 1, grid)).toBe(8);
  });

  it('is held to the next beat for a hop quantised to the beat, as replay holds it', () => {
    expect(arrivalSec(hop(7.6, 'B', { quantise: 'beat' }), 1, grid)).toBe(8);
  });

  it('is held to the next bar for a hop quantised to the bar', () => {
    expect(arrivalSec(hop(8.2, 'B', { quantise: 'bar' }), 1, grid)).toBe(10);
  });
});

describe('segmentsOf', () => {
  it('reads a take as each rifff from its arrival to the next', () => {
    expect(segmentsOf(take(), grid).map((s) => [s.riffId, s.startSec, s.endSec])).toEqual([
      ['A', 0, 8],
      ['B', 8, 16],
      ['C', 16, 24],
    ]);
  });
});

describe('moveHop — dragging a hop point', () => {
  it('snaps to the beat, moving only that hop: earlier here, so B comes in sooner', () => {
    const moved = moveHop(take(), 1, 6.9, 'beat', grid);
    expect(arrivals(moved)).toEqual([0, 7, 16]);
    expect(moved.durationSec).toBe(24);
  });

  it('snaps to the bar when asked', () => {
    expect(arrivals(moveHop(take(), 1, 6.9, 'bar', grid))).toEqual([0, 6, 16]);
  });

  it('goes exactly where it is put with snapping off', () => {
    expect(arrivalSec(moveHop(take(), 1, 6.9, 'off', grid).hops[1]!, 1, grid)).toBeCloseTo(6.9, 9);
  });

  it('stores the moved hop as an exact time, so replay doesn’t hold it again', () => {
    const quantised = take([hop(0, 'A'), hop(7.6, 'B', { quantise: 'beat' }), hop(15.75, 'C')]);
    const moved = moveHop(quantised, 1, 6.9, 'beat', grid);
    expect(moved.hops[1]!.quantise).toBeUndefined();
    expect(moved.hops[1]!.tSec).toBe(6.75);
  });

  it('can’t pass the hop point after it', () => {
    expect(arrivals(moveHop(take(), 1, 30, 'beat', grid))[1]).toBe(15.5);
  });

  it('can’t pass the hop point before it', () => {
    expect(arrivals(moveHop(take(), 1, -3, 'beat', grid))[1]).toBe(0.5);
  });

  it('can’t move the last hop point past the end of the take', () => {
    expect(arrivals(moveHop(take(), 2, 40, 'beat', grid))[2]).toBe(23.5);
  });

  it('leaves the take alone for the first rifff, which has no hop point', () => {
    const t = take();
    expect(moveHop(t, 0, 3, 'beat', grid)).toBe(t);
  });

  it('doesn’t change the take it was given', () => {
    const t = take();
    moveHop(t, 1, 6.9, 'beat', grid);
    expect(arrivals(t)).toEqual([0, 8, 16]);
  });
});

describe('deleteHop — deleting a hop point', () => {
  it('drops the rifff that point brought in, and later hops close the gap', () => {
    const cut = deleteHop(take(), 1, grid);
    expect(cut.hops.map((h) => h.riffId)).toEqual(['A', 'C']);
    expect(arrivals(cut)).toEqual([0, 8]);
    expect(cut.durationSec).toBe(16);
  });

  it('shortens the take by the last rifff when it is the last hop point', () => {
    const cut = deleteHop(take(), 2, grid);
    expect(cut.hops.map((h) => h.riffId)).toEqual(['A', 'B']);
    expect(cut.durationSec).toBe(16);
  });

  it('keeps a later quantised hop exactly where it was heard, relative to the cut', () => {
    const t = take([hop(0, 'A'), hop(7.75, 'B'), hop(15.6, 'C', { quantise: 'beat' })]);
    const cut = deleteHop(t, 1, grid);
    expect(arrivals(cut)).toEqual([0, 8]);
    expect(cut.hops[1]!.quantise).toBeUndefined();
  });

  it('leaves the take alone for the first rifff', () => {
    const t = take();
    expect(deleteHop(t, 0, grid)).toBe(t);
  });
});

describe('insertRiff — adding a skipped rifff at a hop point', () => {
  it('puts the rifff in where that hop point was, for the length given, and later hops move on', () => {
    const added = insertRiff(take(), 1, 'X' as RiffCouchID, 4, grid);
    expect(added.hops.map((h) => h.riffId)).toEqual(['A', 'X', 'B', 'C']);
    expect(arrivals(added)).toEqual([0, 8, 12, 20]);
    expect(added.durationSec).toBe(28);
  });

  it('comes in with the crossfade of the hop it lands on', () => {
    const t = take([hop(0, 'A'), hop(7.9, 'B', { transitionMs: 100 }), hop(15.75, 'C')]);
    expect(insertRiff(t, 1, 'X' as RiffCouchID, 4, grid).hops[1]).toMatchObject({ tSec: 7.9, transitionMs: 100, jamId: JAM });
  });
});

describe('duplicateSegment — duplicating a rifff in the take', () => {
  it('puts another copy right after it, for the length given', () => {
    const dup = duplicateSegment(take(), 1, 4, grid);
    expect(dup.hops.map((h) => h.riffId)).toEqual(['A', 'B', 'B', 'C']);
    expect(arrivals(dup)).toEqual([0, 8, 16, 20]);
    expect(dup.durationSec).toBe(28);
  });

  it('adds to the end of the take when it is the last rifff', () => {
    const dup = duplicateSegment(take(), 2, 4, grid);
    expect(dup.hops.map((h) => h.riffId)).toEqual(['A', 'B', 'C', 'C']);
    expect(arrivals(dup)).toEqual([0, 8, 16, 24]);
    expect(dup.durationSec).toBe(28);
  });

  it('can duplicate the first rifff too', () => {
    expect(duplicateSegment(take(), 0, 4, grid).hops.map((h) => h.riffId)).toEqual(['A', 'A', 'B', 'C']);
  });
});

describe('skippedBetween — what Expand shows', () => {
  const history = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'] as RiffCouchID[];

  it('is the rifffs committed between the two, in commit order', () => {
    expect(skippedBetween(history, 'r2' as RiffCouchID, 'r5' as RiffCouchID)).toEqual(['r3', 'r4']);
  });

  it('is in commit order whichever way the hop went', () => {
    expect(skippedBetween(history, 'r5' as RiffCouchID, 'r2' as RiffCouchID)).toEqual(['r3', 'r4']);
  });

  it('is nothing for neighbouring rifffs, or for a rifff not in the history', () => {
    expect(skippedBetween(history, 'r2' as RiffCouchID, 'r3' as RiffCouchID)).toEqual([]);
    expect(skippedBetween(history, 'r2' as RiffCouchID, 'gone' as RiffCouchID)).toEqual([]);
  });
});
