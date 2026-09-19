import { describe, it, expect } from 'vitest';
import { automationLine } from '../../src/hop-editor/automation-line';

const pts = (...pairs: [number, number][]) => pairs.map(([tSec, value]) => ({ tSec, value }));

describe('automationLine — the drawn shape of a track’s line', () => {
  it('runs volume straight between points, held flat to the take’s start and end', () => {
    expect(automationLine(pts([2, 1], [6, 0.5]), 'volume', 10)).toEqual([
      { tSec: 0, value: 1 },
      { tSec: 2, value: 1 },
      { tSec: 6, value: 0.5 },
      { tSec: 10, value: 0.5 },
    ]);
  });

  it('steps mute and solo: flat, then straight up or down at each point', () => {
    expect(automationLine(pts([0, 0], [4, 1]), 'mute', 8)).toEqual([
      { tSec: 0, value: 0 },
      { tSec: 4, value: 0 },
      { tSec: 4, value: 1 },
      { tSec: 8, value: 1 },
    ]);
  });

  it('is a flat line at the track’s natural state when there are no points', () => {
    expect(automationLine([], 'volume', 8)).toEqual([{ tSec: 0, value: 1 }, { tSec: 8, value: 1 }]);
    expect(automationLine([], 'solo', 8)).toEqual([{ tSec: 0, value: 0 }, { tSec: 8, value: 0 }]);
  });

  it('stops at the end of the take', () => {
    expect(automationLine(pts([0, 1], [20, 0]), 'volume', 10).at(-1)).toEqual({ tSec: 10, value: 0.5 });
  });
});
