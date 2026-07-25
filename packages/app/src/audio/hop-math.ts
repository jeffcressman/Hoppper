export interface HopInputs {
  /** AudioContext.currentTime at the moment the user requested the hop. */
  now: number;
  /**
   * AudioContext time the playback grid began — the cold start that started
   * this run of playback. Every hop is measured from here, never from the
   * previous hop, so the grid stays continuous however many hops happen.
   */
  gridOrigin: number;
  newLoopDur: number;
  /** Crossfade window in seconds. 0 = hard cut. */
  crossfadeSec: number;
  /**
   * Quantised entry: hold the hop until the next multiple of this many
   * seconds on the grid, so the incoming rifff enters on a beat or a bar
   * rather than wherever the click landed. Omitted, zero or non-finite means
   * no quantisation — enter immediately.
   */
  quantiseSec?: number;
}

export interface HopResult {
  /** When to call .start(when, offset) on the new riff's sources. */
  startWhen: number;
  /** Offset into the new riff's buffer at startWhen. */
  offsetInNew: number;
  /**
   * Seconds of grid elapsed at startWhen, unwrapped. Only the remainder is
   * needed to place the riff; the total is kept for logging and tests.
   */
  elapsedOnGrid: number;
  /** How long quantisation held the hop back. 0 when not quantising. */
  quantiseDelaySec: number;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * Where a rifff should pick up when hopped into.
 *
 * Playback runs against one continuous grid: whatever rifff is playing, it
 * plays the position the grid is at, wrapped into its own length. So a hop
 * seven bars into a run lands the incoming rifff at its bar 7 if it is long
 * enough to have one, and at bar 3 of a four-bar rifff, and bar 1 of a
 * two-bar rifff — all of them at the same point within the bar, which is why
 * a hop stays on the beat.
 *
 * This is not quite LORE, whose cursor (`mix/preview.cpp`,
 * `m_riffPlaybackSample`) is wrapped by the *current* rifff's length, so a hop
 * from a two-bar rifff into a sixteen-bar one lands in the latter's first two
 * bars. We keep the grid position instead — see the phase-6 design doc.
 */
export function computeHop(input: HopInputs): HopResult {
  const { now, gridOrigin, newLoopDur, crossfadeSec } = input;

  const unquantised = now + crossfadeSec;
  let startWhen = unquantised;

  const { quantiseSec } = input;
  if (quantiseSec !== undefined && Number.isFinite(quantiseSec) && quantiseSec > 0) {
    const intervals = Math.ceil((startWhen - gridOrigin) / quantiseSec);
    startWhen = gridOrigin + intervals * quantiseSec;
  }

  const elapsedOnGrid = startWhen - gridOrigin;
  const offsetInNew = newLoopDur > 0 ? mod(elapsedOnGrid, newLoopDur) : 0;

  return {
    startWhen,
    offsetInNew,
    elapsedOnGrid,
    quantiseDelaySec: startWhen - unquantised,
  };
}
