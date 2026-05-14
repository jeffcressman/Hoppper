import type { RiffDocument } from '@hoppper/sdk';

export interface RiffTiming {
  bps: number;
  bpm: number;
  quarterBeats: number;
  secPerBar: number;
  barCount: 1 | 2 | 4 | 8;
  loopDurationSec: number;
}

const LENGTH_CLAMP_SEC = 60;
const CANDIDATE_BAR_COUNTS = [8, 4, 2, 1] as const;

export function computeRiffTiming(riff: RiffDocument): RiffTiming {
  const { bps, barLength } = riff;
  const quarterBeats = Math.trunc(barLength / 4);
  const secPerBar = quarterBeats / bps;

  let barCount: 1 | 2 | 4 | 8 = 1;
  for (const n of CANDIDATE_BAR_COUNTS) {
    if (n * secPerBar < LENGTH_CLAMP_SEC) {
      barCount = n;
      break;
    }
  }

  return {
    bps,
    bpm: bps * 60,
    quarterBeats,
    secPerBar,
    barCount,
    loopDurationSec: barCount * secPerBar,
  };
}
