import type { AutomationParam, AutomationPoint } from '../hop-recorder/types';
import { valueAt } from '../automation/automation';

/**
 * The corners of a track's automation line across the take, for drawing:
 * volume straight between points, mute and solo as steps, held flat to the
 * take's start and end — a track with no points is a flat line at its
 * natural state, ready to click a point onto.
 */
export function automationLine(points: AutomationPoint[], param: AutomationParam, durationSec: number): AutomationPoint[] {
  const out: AutomationPoint[] = [{ tSec: 0, value: valueAt(points, 0, param) }];
  for (const p of points) {
    if (p.tSec <= 0 || p.tSec >= durationSec) continue;
    if (param !== 'volume') out.push({ tSec: p.tSec, value: out.at(-1)!.value });
    out.push({ tSec: p.tSec, value: p.value });
  }
  out.push({ tSec: durationSec, value: valueAt(points, durationSec, param) });
  // A step to the same value draws nothing: drop the corner.
  return out.filter((p, i) => {
    const prev = out[i - 1];
    return !prev || prev.tSec !== p.tSec || prev.value !== p.value;
  });
}
