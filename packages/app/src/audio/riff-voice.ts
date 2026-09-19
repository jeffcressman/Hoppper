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

export interface AnalyserNodeLike extends AudioNodeLike {
  fftSize: number;
  getFloatTimeDomainData(array: Float32Array): void;
  connect(destination: AudioNodeLike): void;
}

export interface ChannelSplitterLike extends AudioNodeLike {
  connect(destination: AudioNodeLike, output?: number): void;
  disconnect(): void;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  createBufferSource(): AudioBufferSourceLike;
  createGain(): GainNodeLike;
  /** Optional: only the level meter needs these, and it goes quiet without them. */
  createAnalyser?(): AnalyserNodeLike;
  createChannelSplitter?(numberOfOutputs: number): ChannelSplitterLike;
}

export interface VoiceStem {
  buffer: AudioBufferLike;
  /**
   * Rate to play this stem at so it fits the rifff's tempo — LORE's
   * `stemTimeScale`, `riff.bps / stem.bps`. Omit or 1 for a stem recorded at
   * the rifff's own tempo.
   */
  playbackRate?: number;
  /**
   * The gain the rifff gives this stem's slot (`RiffSlot.gain`, LORE's
   * `m_stemGains`) — the rifff's own mix. Defaults to 1.
   */
  gain?: number;
}

/** A stretch of an automation curve, in context time. */
export interface AutomationStretch {
  atSec: number;
  from: number;
  to: number;
}

/** Glide time for a mixer move: long enough not to click, short enough to feel instant. */
const LEVEL_GLIDE_SEC = 0.02;

export interface RiffVoiceOptions {
  context: AudioContextLike;
  /** 8-slot stem array; nulls are empty stem slots. */
  stems: ReadonlyArray<VoiceStem | null>;
  loopDurationSec: number;
  /** Defaults to context.destination if omitted. */
  destination?: AudioNodeLike;
  /**
   * The mixer's level per slot (0..1, index = slot), multiplied onto each
   * stem's own gain — LORE's `m_layerGainMultiplier`. Defaults to 1 each.
   */
  levels?: ReadonlyArray<number>;
  /**
   * Where each slot's stem is also sent, after its level — the mixer's
   * per-track meters. Index = slot; missing or empty means no meter.
   */
  slotTaps?: ReadonlyArray<AudioNodeLike | undefined>;
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
  /** Glide one slot's mixer level to `level` from `when`. Empty slots ignore it. */
  setSlotLevel(slot: number, level: number, when: number): void;
  /**
   * Schedule a slot's automation from `fromSec` on: a curve of straight
   * stretches in context time — each ramps `from` → `to` until the next,
   * the last holds — times the rifff's own gain for the slot.
   */
  automateSlot(slot: number, curve: ReadonlyArray<AutomationStretch>, fromSec: number): void;
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
  /** The stem's level in the mix: its rifff gain × the mixer's slot level. */
  level: GainNodeLike;
  /** The rifff's gain for this slot. */
  riffGain: number;
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

  const levels = opts.levels ?? [];
  const levelOf = (slot: number) => {
    const l = levels[slot];
    return l !== undefined && Number.isFinite(l) ? Math.max(0, l) : 1;
  };

  const sources: VoiceSource[] = [];
  const bySlot = new Map<number, VoiceSource>();
  for (const [slot, stem] of stems.entries()) {
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
    const riffGain = Number.isFinite(stem.gain ?? 1) ? Math.max(0, stem.gain ?? 1) : 1;
    const level = context.createGain();
    level.gain.value = riffGain * levelOf(slot);
    node.connect(level);
    level.connect(gain);
    const tap = opts.slotTaps?.[slot];
    if (tap) level.connect(tap);
    const source = { node, level, riffGain, rate, bufferLoopSec, loopSec: bufferLoopSec / rate };
    sources.push(source);
    bySlot.set(slot, source);
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
    for (const s of sources) {
      s.node.disconnect();
      s.level.disconnect();
    }
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
    setSlotLevel(slot, level, when) {
      const source = bySlot.get(slot);
      if (!source || !Number.isFinite(level) || !Number.isFinite(when)) return;
      const param = source.level.gain;
      param.cancelScheduledValues(when);
      param.setValueAtTime(param.value, when);
      param.linearRampToValueAtTime(source.riffGain * Math.max(0, level), when + LEVEL_GLIDE_SEC);
    },
    automateSlot(slot, curve, fromSec) {
      const source = bySlot.get(slot);
      if (!source || curve.length === 0 || !Number.isFinite(fromSec)) return;
      const g = source.riffGain;
      const param = source.level.gain;
      param.cancelScheduledValues(fromSec);
      // The stretch playing at fromSec, if the curve has begun by then.
      let i = -1;
      while (i + 1 < curve.length && curve[i + 1]!.atSec <= fromSec) i++;
      let current: number;
      if (i === -1) {
        current = curve[0]!.from;
        param.setValueAtTime(current * g, fromSec);
      } else {
        const seg = curve[i]!;
        const next = curve[i + 1];
        current = next ? seg.from + ((seg.to - seg.from) * (fromSec - seg.atSec)) / (next.atSec - seg.atSec) : seg.from;
        param.setValueAtTime(current * g, fromSec);
        if (next) {
          param.linearRampToValueAtTime(seg.to * g, next.atSec);
          current = seg.to;
        }
      }
      for (let k = i + 1; k < curve.length; k++) {
        const seg = curve[k]!;
        const next = curve[k + 1];
        // A step where the curve jumps; nothing where it carries straight on.
        if (seg.from !== current) param.setValueAtTime(seg.from * g, seg.atSec);
        current = seg.from;
        if (next) {
          param.linearRampToValueAtTime(seg.to * g, next.atSec);
          current = seg.to;
        }
      }
    },
    dispose,
  };
}
