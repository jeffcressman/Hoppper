import type { RiffDocument, StemCouchID, StemDocument } from '@hoppper/sdk';
import { computeRiffTiming } from '../audio/riff-timing';
import { bufferMinMax, bufferPeaks, loopRow, type PeakSource } from './peaks';

export type DecodedStem = PeakSource & { duration: number };

export interface StemAudio {
  stemId: StemCouchID;
  buffer: DecodedStem;
  /** The stem's own loop in rifff time, after tempo scaling. */
  loopSec: number;
}

const PEAK_BINS = 512;
// A stem's audio never changes, so its peaks are worked out once, ever.
const peaksCache = new Map<StemCouchID, Float32Array>();

export function stemPeaks(stemId: StemCouchID, buffer: PeakSource): Float32Array {
  let peaks = peaksCache.get(stemId);
  if (!peaks) {
    peaks = bufferPeaks(buffer, PEAK_BINS);
    peaksCache.set(stemId, peaks);
  }
  return peaks;
}

const WAVE_BINS = 2048;
const waveCache = new Map<StemCouchID, { min: Float32Array; max: Float32Array }>();

/**
 * A stem's waveform once around the rifff's loop, for its splat layer: for
 * each of `slices`, the highest then the lowest sample, in turn, signed. A
 * stem shorter than the loop repeats inside it, as it plays.
 */
export function waveRing(stem: StemAudio, riffLoopSec: number, slices: number): Float32Array {
  let wave = waveCache.get(stem.stemId);
  if (!wave) {
    wave = bufferMinMax(stem.buffer, WAVE_BINS);
    waveCache.set(stem.stemId, wave);
  }
  const hi = loopRow(wave.max, stem.loopSec, riffLoopSec, slices);
  const lo = loopRow(wave.min, stem.loopSec, riffLoopSec, slices);
  const ring = new Float32Array(slices * 2);
  for (let i = 0; i < slices; i++) {
    ring[i * 2] = hi[i]!;
    ring[i * 2 + 1] = lo[i]!;
  }
  return ring;
}

function isDecoded(b: unknown): b is DecodedStem {
  return !!b && typeof (b as PeakSource).getChannelData === 'function';
}

/**
 * A rifff's decoded stems by slot, and its loop as it plays — the computed
 * length pushed out to fit its longest stem, as `RiffVoice.effectiveLoopSec`.
 * A stem from a rifff at another tempo plays at `riff.bps / stem.bps` (LORE's
 * stemTimeScale), which changes its length in rifff time.
 */
export function riffStemAudio(
  riff: RiffDocument,
  docOf: (id: StemCouchID) => StemDocument | null | undefined,
  bufferOf: (id: StemCouchID) => unknown,
): { stems: (StemAudio | null)[]; loopSec: number } {
  const stems = Array.from({ length: 8 }, (_, slot): StemAudio | null => {
    const s = riff.slots[slot];
    if (!s?.on || !s.stemId) return null;
    const stemId = s.stemId as StemCouchID;
    const buffer = bufferOf(stemId);
    if (!isDecoded(buffer)) return null;
    const doc = docOf(stemId);
    const rate = doc && doc.bps > 0 && riff.bps > 0 ? riff.bps / doc.bps : 1;
    return { stemId, buffer, loopSec: buffer.duration / rate };
  });
  const loopSec = Math.max(computeRiffTiming(riff).loopDurationSec, ...stems.map((s) => s?.loopSec ?? 0));
  return { stems, loopSec };
}
