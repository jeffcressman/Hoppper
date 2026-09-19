import { describe, it, expect } from 'vitest';
import type { RiffCouchID } from '@hoppper/sdk';
import { timelineLayout } from '../../src/hop-editor/layout';
import type { Segment } from '../../src/hop-editor/edits';

const seg = (index: number, riffId: string, startSec: number, endSec: number): Segment => ({
  index,
  riffId: riffId as RiffCouchID,
  startSec,
  endSec,
});
// A, B, C at 0, 8 and 16 s; the take ends at 24 s.
const segments = [seg(0, 'A', 0, 8), seg(1, 'B', 8, 16), seg(2, 'C', 16, 24)];
const loopSecOf = () => 4;

const blocks = (l: ReturnType<typeof timelineLayout>) =>
  l.blocks.map((b) => [b.riffId, b.lane, b.startSec, b.endSec, b.kind]);
const pins = (l: ReturnType<typeof timelineLayout>) => l.pins.map((p) => [p.num, p.atSec, p.kind]);

describe('timelineLayout', () => {
  it('lays the take out in one lane, with a numbered hop point where each rifff comes in', () => {
    const l = timelineLayout(segments, { point: null, skipped: [] }, loopSecOf);
    expect(blocks(l)).toEqual([
      ['A', 1, 0, 8, 'seg'],
      ['B', 1, 8, 16, 'seg'],
      ['C', 1, 16, 24, 'seg'],
    ]);
    expect(pins(l)).toEqual([
      [1, 8, 'plain'],
      [2, 16, 'plain'],
    ]);
    expect(l.split).toBe(false);
    expect(l.endSec).toBe(24);
  });

  it('splits into two lanes around a selected hop point, showing each side running on', () => {
    const l = timelineLayout(segments, { point: 1, skipped: [] }, loopSecOf);
    expect(blocks(l)).toEqual([
      ['A', 1, 0, 8, 'seg'],
      ['B', 2, 8, 16, 'seg'],
      ['C', 2, 16, 24, 'seg'],
      // A carrying on past the point, and B's run-in before it: one loop each.
      ['A', 1, 8, 12, 'ghost'],
      ['B', 2, 4, 8, 'ghost'],
    ]);
    expect(pins(l)).toEqual([
      [1, 8, 'selected'],
      [2, 16, 'plain'],
    ]);
    expect(l.split).toBe(true);
  });

  it('keeps a run-in from starting before the take', () => {
    const l = timelineLayout([seg(0, 'A', 0, 2), seg(1, 'B', 2, 10)], { point: 1, skipped: [] }, loopSecOf);
    expect(blocks(l).find((b) => b[4] === 'ghost' && b[1] === 2)).toEqual(['B', 2, 0, 2, 'ghost']);
  });

  it('expanded, lays the skipped rifffs after the point and moves the rest along', () => {
    const skipped = [
      { riffId: 'X' as RiffCouchID, lengthSec: 4 },
      { riffId: 'Y' as RiffCouchID, lengthSec: 4 },
    ];
    const l = timelineLayout(segments, { point: 1, skipped }, loopSecOf);
    expect(blocks(l)).toEqual([
      ['A', 1, 0, 8, 'seg'],
      ['B', 2, 16, 24, 'seg'],
      ['C', 2, 24, 32, 'seg'],
      ['X', 1, 8, 12, 'skip'],
      ['Y', 1, 12, 16, 'skip'],
    ]);
    // Hop point 1 stays selected; a dashed candidate sits between X and Y;
    // B's hop point now comes after them, and every later one is renumbered.
    expect(pins(l)).toEqual([
      [1, 8, 'selected'],
      [2, 12, 'candidate'],
      [3, 16, 'plain'],
      [4, 24, 'plain'],
    ]);
    expect(l.endSec).toBe(32);
  });

  it('says which hop and which skipped rifff each piece belongs to', () => {
    const skipped = [{ riffId: 'X' as RiffCouchID, lengthSec: 4 }];
    const l = timelineLayout(segments, { point: 1, skipped }, loopSecOf);
    expect(l.blocks.find((b) => b.riffId === 'X')?.skipIndex).toBe(0);
    expect(l.blocks.find((b) => b.riffId === 'C')?.segIndex).toBe(2);
    expect(l.pins.map((p) => p.hopIndex)).toEqual([1, undefined, 2]);
  });
});
