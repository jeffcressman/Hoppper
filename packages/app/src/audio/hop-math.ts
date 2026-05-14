export interface HopInputs {
  /** AudioContext.currentTime at the moment the user requested the hop. */
  now: number;
  /** AudioContext time at which the currently-playing riff began. */
  prevStart: number;
  prevLoopDur: number;
  newLoopDur: number;
  /** Crossfade window in seconds. 0 = hard cut. */
  crossfadeSec: number;
  /** When true, startWhen is rounded up to the next bar boundary in prev's grid. */
  snapToBar?: boolean;
  /** Required when snapToBar is true. */
  prevSecPerBar?: number;
}

export interface HopResult {
  /** When to call .start(when, offset) on the new riff's sources. */
  startWhen: number;
  /** Offset into the new riff's buffer at startWhen. */
  offsetInNew: number;
  /** Where the previous riff's loop will be at startWhen (debugging/observability). */
  elapsedInPrev: number;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

export function computeHop(input: HopInputs): HopResult {
  const { now, prevStart, prevLoopDur, newLoopDur, crossfadeSec } = input;

  let startWhen = now + crossfadeSec;

  if (input.snapToBar) {
    const secPerBar = input.prevSecPerBar;
    if (secPerBar === undefined || secPerBar <= 0) {
      throw new Error('snapToBar requires a positive prevSecPerBar');
    }
    const offsetFromPrev = startWhen - prevStart;
    const bars = Math.ceil(offsetFromPrev / secPerBar);
    startWhen = prevStart + bars * secPerBar;
  }

  const elapsedInPrev = mod(startWhen - prevStart, prevLoopDur);
  const offsetInNew = mod(elapsedInPrev, newLoopDur);

  return { startWhen, elapsedInPrev, offsetInNew };
}
