import type { AudioBufferLike } from './audio-buffer-cache.js';

// Narrow facades over Web Audio so unit tests can run without a real
// AudioContext. The Web Audio types are structurally compatible.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AudioNodeLike {}

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, when: number): void;
  linearRampToValueAtTime(value: number, when: number): void;
  cancelScheduledValues(when: number): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
  connect(destination: AudioNodeLike): void;
  disconnect(): void;
}

export interface AudioBufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  readonly playbackRate: AudioParamLike;
  // Loose signature so a real AudioBufferSourceNode satisfies us structurally.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onended: ((...args: any[]) => any) | null;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
  connect(destination: AudioNodeLike): void;
  disconnect(): void;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  createBufferSource(): AudioBufferSourceLike;
  createGain(): GainNodeLike;
}

export interface VoiceStem {
  buffer: AudioBufferLike;
  /**
   * Rate to play this stem at so it fits the rifff's tempo — LORE's
   * `stemTimeScale`, `riff.bps / stem.bps`. Omit or 1 for a stem recorded at
   * the rifff's own tempo.
   */
  playbackRate?: number;
}

export interface RiffVoiceOptions {
  context: AudioContextLike;
  /** 8-slot stem array; nulls are empty stem slots. */
  stems: ReadonlyArray<VoiceStem | null>;
  loopDurationSec: number;
  /** Defaults to context.destination if omitted. */
  destination?: AudioNodeLike;
}

export interface RiffVoice {
  readonly stemCount: number;
  /**
   * The loop this voice actually plays, which is the riff's computed loop
   * duration unless every stem it holds is shorter than that. Callers doing
   * phase math must use this, not the computed riff loop.
   */
  readonly effectiveLoopSec: number;
  start(when: number, offset: number): void;
  /**
   * Schedule the end of playback. The voice disposes itself once the last
   * source reports it has ended, so a caller can fade out and stop in one go
   * without cutting the fade short.
   */
  stop(when: number): void;
  fadeIn(startTime: number, durationSec: number): void;
  fadeOut(startTime: number, durationSec: number): void;
  dispose(): void;
}

function usableLoop(sec: number): boolean {
  return Number.isFinite(sec) && sec > 0;
}

/**
 * Wrap a phase offset into a stem's loop. Web Audio throws on a non-finite
 * offset, and a throw part-way through starting a voice would leave the rest
 * of the hop unscheduled, so damaged timing degrades to "start at 0" rather
 * than taking the hop down with it.
 */
function wrapOffset(offset: number, loopSec: number): number {
  if (!Number.isFinite(offset)) return 0;
  if (!usableLoop(loopSec)) return Math.max(0, offset);
  return ((offset % loopSec) + loopSec) % loopSec;
}

interface VoiceSource {
  node: AudioBufferSourceLike;
  /** How fast this stem's buffer is traversed; 1 = its recorded tempo. */
  rate: number;
  /** This stem's own loop length in buffer time (i.e. unscaled). */
  bufferLoopSec: number;
  /** The same loop measured in rifff time, which is what offsets are in. */
  loopSec: number;
}

export function createRiffVoice(opts: RiffVoiceOptions): RiffVoice {
  const { context, stems, loopDurationSec } = opts;
  const destination = opts.destination ?? context.destination;

  const gain = context.createGain();
  gain.connect(destination);

  const sources: VoiceSource[] = [];
  for (const stem of stems) {
    if (stem === null) continue;
    const { buffer } = stem;
    // A stem borrowed from a rifff at another tempo is played faster or slower
    // to fit (LORE's stemTimeScale). A non-finite or zero rate would throw and
    // take the voice down mid-hop, so an unusable one means "as recorded".
    const rate = usableLoop(stem.playbackRate ?? 1) ? (stem.playbackRate ?? 1) : 1;
    // Each stem loops at its own length: a short one repeats inside the riff,
    // a long one pushes the riff out (LORE, live.riff.cpp — riff length is
    // max(computed, longest stem)). Web Audio would end a short stem's loop at
    // its buffer end anyway; being explicit lets us wrap start offsets to
    // match, so a stem lands at its position in the bar rather than at its
    // end. Falls back to 0 — "loop the whole buffer" — for an unusable
    // duration, since a non-finite loopEnd would throw.
    const bufferLoopSec = usableLoop(buffer.duration) ? buffer.duration : 0;
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    node.loopStart = 0;
    // loopEnd and start offsets are positions in the buffer, unaffected by
    // rate; only how quickly we move through them changes.
    node.loopEnd = bufferLoopSec;
    node.playbackRate.value = rate;
    node.connect(gain);
    sources.push({ node, rate, bufferLoopSec, loopSec: bufferLoopSec / rate });
  }

  // The riff plays for as long as its longest stem, but never less than the
  // length bps/barLength imply — short stems repeat rather than shortening it.
  const longestStemLoop =
    sources.length === 0 ? 0 : Math.max(...sources.map((s) => s.loopSec));
  const computed = usableLoop(loopDurationSec) ? loopDurationSec : 0;
  const effectiveLoopSec = Math.max(computed, longestStemLoop);

  let started = false;
  let disposed = false;
  let pendingEnds = 0;

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const s of sources) s.node.disconnect();
    gain.disconnect();
  }

  return {
    stemCount: sources.length,
    effectiveLoopSec,
    start(when, offset) {
      if (started) throw new Error('RiffVoice.start may only be called once');
      started = true;
      for (const s of sources) {
        // `offset` is a position in the rifff; convert it to a position in
        // this stem's buffer after wrapping it into the stem's own loop.
        const inRiffTime = wrapOffset(offset, s.loopSec);
        s.node.start(when, inRiffTime * s.rate);
      }
    },
    stop(when) {
      // stop() before start() throws InvalidStateError in Web Audio; there is
      // nothing playing to stop, so tear down instead of throwing mid-hop.
      if (!started) {
        dispose();
        return;
      }
      if (sources.length === 0) {
        dispose();
        return;
      }
      pendingEnds = sources.length;
      for (const s of sources) {
        s.node.onended = () => {
          pendingEnds -= 1;
          if (pendingEnds <= 0) dispose();
        };
        s.node.stop(when);
      }
    },
    fadeIn(startTime, durationSec) {
      gain.gain.cancelScheduledValues(startTime);
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(1, startTime + durationSec);
    },
    fadeOut(startTime, durationSec) {
      const from = gain.gain.value;
      gain.gain.cancelScheduledValues(startTime);
      gain.gain.setValueAtTime(from, startTime);
      gain.gain.linearRampToValueAtTime(0, startTime + durationSec);
    },
    dispose,
  };
}
