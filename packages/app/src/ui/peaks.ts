// Waveforms from decoded stems. A stem's buffer is immutable, so its peaks
// never need working out twice (the waveform component keeps them by stem).

export interface PeakSource {
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

/** The loudest sample in each of `bins` slices of the buffer, across channels. */
export function bufferPeaks(buffer: PeakSource, bins: number): Float32Array {
  const out = new Float32Array(bins);
  if (buffer.length === 0 || bins <= 0) return out;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let b = 0; b < bins; b++) {
      const from = Math.floor((b * data.length) / bins);
      const to = Math.max(from + 1, Math.floor(((b + 1) * data.length) / bins));
      let max = out[b]!;
      for (let i = from; i < to && i < data.length; i++) max = Math.max(max, Math.abs(data[i]!));
      out[b] = max;
    }
  }
  return out;
}

/**
 * One rifff loop's worth of a stem, in `bins` slices. A stem shorter than the
 * loop repeats inside it, just as it plays (`RiffVoice`); both lengths are in
 * rifff time, i.e. after any tempo scaling.
 */
export function loopRow(
  peaks: Float32Array,
  stemLoopSec: number,
  riffLoopSec: number,
  bins: number,
): Float32Array {
  const out = new Float32Array(bins);
  if (!(stemLoopSec > 0) || !(riffLoopSec > 0) || peaks.length === 0) return out;
  for (let b = 0; b < bins; b++) {
    const t = ((b + 0.5) / bins) * riffLoopSec;
    const within = (t % stemLoopSec) / stemLoopSec;
    out[b] = peaks[Math.min(peaks.length - 1, Math.floor(within * peaks.length))]!;
  }
  return out;
}

/** An SVG path for a row `values.length` wide and 20 high, mirrored about the middle. */
export function rowPath(values: Float32Array): string {
  if (values.length === 0) return '';
  let top = 'M0 10';
  let bottom = '';
  values.forEach((v, i) => {
    const a = Math.min(1, v) * 9;
    const x = i + 0.5;
    top += `L${x} ${+(10 - a).toFixed(1)}`;
    bottom = `L${x} ${+(10 + a).toFixed(1)}` + bottom;
  });
  return `${top}L${values.length} 10${bottom}Z`;
}

/**
 * The highest and lowest sample in each of `bins` slices, across channels —
 * what a waveform display draws. Unlike `bufferPeaks` it keeps the swing
 * either side of zero, so even a steady pad reads as a waveform, not a line.
 */
export function bufferMinMax(buffer: PeakSource, bins: number): { min: Float32Array; max: Float32Array } {
  const min = new Float32Array(bins);
  const max = new Float32Array(bins);
  if (buffer.length === 0 || bins <= 0) return { min, max };
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let b = 0; b < bins; b++) {
      const from = Math.floor((b * data.length) / bins);
      const to = Math.max(from + 1, Math.floor(((b + 1) * data.length) / bins));
      let lo = min[b]!;
      let hi = max[b]!;
      for (let i = from; i < to && i < data.length; i++) {
        const v = data[i]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      min[b] = lo;
      max[b] = hi;
    }
  }
  return { min, max };
}

/**
 * A stretch of the take, `fromSec`–`toSec` on its grid, as this stem sounds
 * then, in `bins` slices. Playback is phase-locked to one continuous grid:
 * at grid time t a rifff plays its loop at t mod its loop length, whenever it
 * came in — so a rifff entering mid-loop is drawn from mid-loop.
 */
export function phaseRow(
  peaks: Float32Array,
  stemLoopSec: number,
  riffLoopSec: number,
  fromSec: number,
  toSec: number,
  bins: number,
): Float32Array {
  const out = new Float32Array(Math.max(0, bins));
  if (!(stemLoopSec > 0) || !(riffLoopSec > 0) || peaks.length === 0 || !(toSec > fromSec)) return out;
  const span = toSec - fromSec;
  const wrap = (x: number, n: number) => ((x % n) + n) % n;
  for (let b = 0; b < bins; b++) {
    const t = fromSec + ((b + 0.5) / bins) * span;
    const inStem = wrap(wrap(t, riffLoopSec), stemLoopSec) / stemLoopSec;
    out[b] = peaks[Math.min(peaks.length - 1, Math.floor(inStem * peaks.length))]!;
  }
  return out;
}
