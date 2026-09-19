import { describe, it, expect } from 'vitest';
import type { AutomationPoint, TrackAutomation } from '../../src/hop-recorder/types';
import {
  addPoint,
  blankAutomation,
  cutTime,
  insertTime,
  levelAt,
  levelCurve,
  movePoint,
  removePoint,
  trimAfter,
  valueAt,
} from '../../src/automation/automation';

const pts = (...pairs: [number, number][]): AutomationPoint[] => pairs.map(([tSec, value]) => ({ tSec, value }));
function tracks(set: (tracks: TrackAutomation[]) => void): TrackAutomation[] {
  const t = blankAutomation();
  set(t);
  return t;
}

describe('valueAt', () => {
  it('ramps volume in a straight line between points', () => {
    expect(valueAt(pts([0, 1], [4, 0]), 1, 'volume')).toBe(0.75);
  });

  it('steps mute and solo: each point holds until the next', () => {
    expect(valueAt(pts([0, 0], [4, 1]), 3.9, 'mute')).toBe(0);
    expect(valueAt(pts([0, 0], [4, 1]), 4, 'mute')).toBe(1);
  });

  it('holds the first value before it and the last after', () => {
    expect(valueAt(pts([2, 0.5], [4, 0.2]), 0, 'volume')).toBe(0.5);
    expect(valueAt(pts([2, 0.5], [4, 0.2]), 9, 'volume')).toBe(0.2);
  });

  it('with no points, a track is at full volume, unmuted, not soloed', () => {
    expect(valueAt([], 3, 'volume')).toBe(1);
    expect(valueAt([], 3, 'mute')).toBe(0);
    expect(valueAt([], 3, 'solo')).toBe(0);
  });

  it('jumps where two points share a time', () => {
    expect(valueAt(pts([0, 1], [4, 1], [4, 0.2], [8, 0.2]), 5, 'volume')).toBeCloseTo(0.2, 9);
  });
});

describe('levelAt / levelCurve — what a track is heard at', () => {
  it('is the track’s volume while it isn’t muted', () => {
    const t = tracks((t) => (t[0]!.volume = pts([0, 1], [4, 0.5])));
    expect(levelAt(t, 0, 2)).toBe(0.75);
  });

  it('is silent while muted', () => {
    const t = tracks((t) => (t[0]!.mute = pts([0, 0], [2, 1])));
    expect(levelAt(t, 0, 1)).toBe(1);
    expect(levelAt(t, 0, 3)).toBe(0);
  });

  it('is silent while another track is soloed and this one isn’t', () => {
    const t = tracks((t) => (t[3]!.solo = pts([0, 0], [2, 1])));
    expect(levelAt(t, 0, 3)).toBe(0);
    expect(levelAt(t, 3, 3)).toBe(1);
  });

  it('a curve for the engine: straight ramps where volume moves, steps where mute or solo change', () => {
    const t = tracks((t) => {
      t[0]!.volume = pts([0, 1], [4, 0.5]);
      t[0]!.mute = pts([0, 0], [2, 1], [3, 0]);
    });
    expect(levelCurve(t, 0)).toEqual([
      { tSec: 0, from: 1, to: 0.75 },
      { tSec: 2, from: 0, to: 0 },
      { tSec: 3, from: 0.625, to: 0.5 },
      { tSec: 4, from: 0.5, to: 0.5 },
    ]);
  });

  it('turns on another track’s solo into steps in this track’s curve', () => {
    const t = tracks((t) => (t[5]!.solo = pts([0, 0], [6, 1])));
    expect(levelCurve(t, 0)).toEqual([
      { tSec: 0, from: 1, to: 1 },
      { tSec: 6, from: 0, to: 0 },
    ]);
  });

  it('with no automation, a flat line at full level', () => {
    expect(levelCurve(blankAutomation(), 2)).toEqual([{ tSec: 0, from: 1, to: 1 }]);
  });
});

describe('editing points', () => {
  it('adds a point in time order', () => {
    expect(addPoint(pts([0, 1], [8, 0]), 4, 0.5)).toEqual(pts([0, 1], [4, 0.5], [8, 0]));
  });

  it('moves a point, keeping it between its neighbours', () => {
    expect(movePoint(pts([0, 1], [4, 0.5], [8, 0]), 1, 9, 0.3)).toEqual(pts([0, 1], [8, 0.3], [8, 0]));
    expect(movePoint(pts([0, 1], [4, 0.5], [8, 0]), 1, 2, 0.3)).toEqual(pts([0, 1], [2, 0.3], [8, 0]));
  });

  it('keeps a value in range', () => {
    expect(addPoint([], 1, 1.4)).toEqual(pts([1, 1]));
    expect(addPoint([], 1, -2)).toEqual(pts([1, 0]));
  });

  it('removes a point', () => {
    expect(removePoint(pts([0, 1], [4, 0.5], [8, 0]), 1)).toEqual(pts([0, 1], [8, 0]));
  });
});

describe('time edits carry automation with the music', () => {
  const volume = (a: TrackAutomation[]) => a[0]!.volume;

  it('cutting a stretch out removes its points and closes the gap, keeping what came after as it was', () => {
    const t = tracks((t) => (t[0]!.volume = pts([0, 1], [4, 0.2], [10, 0.8], [12, 0.8])));
    const cut = cutTime(t, 2, 8);
    // Up to the cut as before; from it, what was at 8 onwards.
    for (const at of [0, 1, 1.9]) expect(valueAt(volume(cut), at, 'volume')).toBeCloseTo(valueAt(volume(t), at, 'volume'), 9);
    for (const at of [2, 3, 4, 6]) expect(valueAt(volume(cut), at, 'volume')).toBeCloseTo(valueAt(volume(t), at + 6, 'volume'), 9);
  });

  it('inserting time holds the level across it and pushes the rest along', () => {
    const t = tracks((t) => (t[0]!.mute = pts([0, 0], [4, 1])));
    const grown = insertTime(t, 2, 3);
    expect(valueAt(grown[0]!.mute, 3, 'mute')).toBe(0);
    expect(valueAt(grown[0]!.mute, 6.9, 'mute')).toBe(0);
    expect(valueAt(grown[0]!.mute, 7, 'mute')).toBe(1);
  });

  it('trimming the end drops what came after it', () => {
    const t = tracks((t) => (t[0]!.volume = pts([0, 1], [10, 0])));
    const trimmed = trimAfter(t, 5);
    expect(volume(trimmed).every((p) => p.tSec <= 5)).toBe(true);
    expect(valueAt(volume(trimmed), 5, 'volume')).toBeCloseTo(0.5, 9);
  });

  it('leaves a take without automation alone', () => {
    expect(cutTime(undefined, 1, 2)).toBeUndefined();
    expect(insertTime(undefined, 1, 2)).toBeUndefined();
  });
});
