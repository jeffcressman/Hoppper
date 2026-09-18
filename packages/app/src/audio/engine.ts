import type {
  JamCouchID,
  ResolvedStem,
  RiffCouchID,
  RiffDocument,
  StemCouchID,
} from '@hoppper/sdk';
import { computeHop } from './hop-math.js';
import { computeRiffTiming } from './riff-timing.js';
import type { AudioBufferLike } from './audio-buffer-cache.js';
import {
  createRiffVoice,
  type AnalyserNodeLike,
  type AudioContextLike,
  type RiffVoice,
  type VoiceStem,
} from './riff-voice.js';
import type { StemLoader } from './stem-loader.js';
import { placeStems, SLOT_COUNT } from './slots.js';

export type AudioEngineState = 'idle' | 'playing';

// `atSec` is the AudioContext time the engine acted on the hop: for a hop,
// before its crossfade and any quantise hold. It is when the hop happened as
// far as a recording is concerned — however long the rifff took to load.
export type HopResult =
  | { kind: 'started'; riffId: RiffCouchID; whenSec: number; atSec: number }
  | {
      kind: 'phase-locked';
      riffId: RiffCouchID;
      whenSec: number;
      offsetSec: number;
      atSec: number;
    }
  | { kind: 'not-ready'; missingStemIds: StemCouchID[] };

export interface AudioEngineOptions {
  context: AudioContextLike;
  loader: StemLoader;
  /** Crossfade duration in ms. Default 250. */
  defaultCrossfadeMs?: number;
  /**
   * Optional sink for per-hop diagnostics. Hop problems are audible long
   * before they are visible, so every hop reports the numbers that decide
   * how it sounds: loop length, phase offset, stem count.
   */
  logger?: (level: 'debug' | 'warn', message: string) => void;
}

/** Musical grid the incoming rifff may be held back to. */
export type HopQuantise = 'beat' | 'bar';

export interface HopOptions {
  crossfadeMs?: number;
  /**
   * Hold the hop until the next beat or bar on the grid, so the incoming
   * rifff enters in time rather than wherever the click landed. Omitted means
   * enter immediately, which is the default everywhere.
   */
  quantise?: HopQuantise;
}

export interface AudioEngine {
  readonly state: AudioEngineState;
  readonly currentRiffId: RiffCouchID | null;
  now(): number;
  warmRiff(
    jamId: JamCouchID,
    riff: RiffDocument,
    stems: ResolvedStem[],
  ): Promise<void>;
  hopTo(
    jamId: JamCouchID,
    riff: RiffDocument,
    stems: ResolvedStem[],
    opts?: HopOptions,
  ): Promise<HopResult>;
  stop(): void;
  /**
   * The mixer: a level per slot (0..1), multiplied onto each stem's own rifff
   * gain — LORE's `m_layerGainMultiplier`. It belongs to the slot, not the
   * rifff, so it holds across hops. All 1 until set.
   */
  readonly slotLevels: ReadonlyArray<number>;
  setSlotLevels(levels: ReadonlyArray<number>): void;
  /**
   * Where playback is in the playing rifff's loop, on the same continuous
   * grid hops are measured against — so it is where the audio is. Null while
   * nothing plays.
   */
  playhead(): { riffId: RiffCouchID; positionSec: number; loopSec: number } | null;
  /** Peak output level of the left and right channels just now, 0..1. */
  levels(): [number, number];
  onStateChange(fn: (s: AudioEngineState) => void): () => void;
  /**
   * Fires whenever `currentRiffId` changes: a cold start, every hop, and
   * `null` on stop. `onStateChange` stays quiet across a hop, since the state
   * is 'playing' either side of it.
   */
  onRiffChange(fn: (riffId: RiffCouchID | null) => void): () => void;
}

interface ActiveVoice {
  riffId: RiffCouchID;
  voice: RiffVoice;
  /** The loop this voice plays, kept for the log line's context. */
  loopDurationSec: number;
  /** When this voice's audio begins — later than the click for a held hop. */
  startsAt: number;
}

interface OutgoingVoice {
  voice: RiffVoice;
  /** When its scheduled stop takes effect, after which it has torn down. */
  stopAt: number;
}

export function createAudioEngine(opts: AudioEngineOptions): AudioEngine {
  const { context, loader } = opts;
  const defaultCrossfadeMs = opts.defaultCrossfadeMs ?? 250;
  const logger = opts.logger;

  let state: AudioEngineState = 'idle';
  let current: ActiveVoice | null = null;
  // The grid every hop is measured against: the AudioContext time playback
  // started. Reset only on stop, so a run of hops stays on one continuous
  // grid — measuring from the previous hop instead is what put hops off the
  // beat (see docs/phases/phase-6-audio-engine.md).
  let gridOrigin: number | null = null;
  // Voices hopped away from that may still be sounding: fading out, or held
  // at full volume until a quantised hop's moment arrives. Stop has to reach
  // these as well as `current`.
  let outgoing: OutgoingVoice[] = [];
  let slotLevels: number[] = Array(SLOT_COUNT).fill(1);

  // Every voice plays into one master bus, which the level meter taps.
  const master = context.createGain();
  master.connect(context.destination);
  const meters: { node: AnalyserNodeLike; frame: Float32Array }[] = [];
  if (context.createAnalyser && context.createChannelSplitter) {
    const splitter = context.createChannelSplitter(2);
    master.connect(splitter);
    // Some WebKit builds only run an analyser that feeds something audible;
    // a silent path to the destination keeps the meters fed without playing
    // everything twice.
    const sink = context.createGain();
    sink.gain.value = 0;
    sink.connect(context.destination);
    for (const channel of [0, 1]) {
      const node = context.createAnalyser();
      node.fftSize = 1024;
      splitter.connect(node, channel);
      node.connect(sink);
      meters.push({ node, frame: new Float32Array(1024) });
    }
  }
  const listeners = new Set<(s: AudioEngineState) => void>();
  const riffListeners = new Set<(riffId: RiffCouchID | null) => void>();

  const sec = (n: number): string => `${n.toFixed(2)}s`;

  function log(level: 'debug' | 'warn', message: string): void {
    logger?.(level, message);
  }

  /**
   * Stems shorter than the rifff repeat inside it, which is normal — but only
   * if they fit a whole number of times. A ragged ratio (LORE's
   * `repeats = round(riffLength / stemLength)`) means the stem cannot line up
   * on every repeat, and that is audible as a rifff fighting itself.
   */
  function warnOnRaggedStems(
    riffId: RiffCouchID,
    stems: ResolvedStem[],
    buffers: ReadonlyArray<AudioBufferLike | null>,
    loopSec: number,
  ): void {
    if (loopSec <= 0) return;
    const ragged: string[] = [];
    for (let i = 0; i < buffers.length; i++) {
      const buffer = buffers[i];
      const stemId = stems[i]?.stemId;
      if (!buffer || stemId === undefined || buffer.duration <= 0) continue;
      const repeats = loopSec / buffer.duration;
      if (Math.abs(repeats - Math.round(repeats)) > 0.01) {
        ragged.push(`${stemId} (${sec(buffer.duration)} → ${repeats.toFixed(2)}×)`);
      }
    }
    if (ragged.length === 0) return;
    log(
      'warn',
      `rifff ${riffId} has stems that don't fit its ${sec(loopSec)} loop a whole ` +
        `number of times: ${ragged.join(', ')}`,
    );
  }

  function emitRiffChange(): void {
    const riffId = current?.riffId ?? null;
    for (const l of riffListeners) l(riffId);
  }

  function setState(next: AudioEngineState): void {
    if (next === state) return;
    state = next;
    for (const l of listeners) l(state);
  }

  function peekBuffers(stems: ResolvedStem[]): {
    buffers: (AudioBufferLike | null)[];
    missing: StemCouchID[];
  } {
    const buffers: (AudioBufferLike | null)[] = [];
    const missing: StemCouchID[] = [];
    for (const s of stems) {
      const b = loader.peek(s.stemId);
      if (b === undefined) {
        missing.push(s.stemId);
        buffers.push(null);
      } else {
        buffers.push(b);
      }
    }
    return { buffers, missing };
  }

  /**
   * A stem can be reused by a rifff at a different tempo, in which case it has
   * to be played faster or slower to fit — LORE's
   * `stemTimeScale = riff.BPS / stem.BPS` (live.riff.cpp).
   */
  function playbackRateFor(riff: RiffDocument, stem: ResolvedStem): number {
    if (!(stem.bps > 0) || !(riff.bps > 0)) return 1;
    const rate = riff.bps / stem.bps;
    return Number.isFinite(rate) && rate > 0 ? rate : 1;
  }

  /**
   * Which stems are being played at something other than their recorded
   * tempo, and how hard. Silent when nothing is scaled, which is the norm.
   */
  function describeScaling(voiceStems: ReadonlyArray<VoiceStem | null>): string {
    const present = voiceStems.filter((v): v is VoiceStem => v !== null);
    const scaled = present.filter((v) => Math.abs((v.playbackRate ?? 1) - 1) > 1e-4);
    if (scaled.length === 0) return '';
    const rates = scaled.map((v) => `${(v.playbackRate ?? 1).toFixed(3)}×`).join(', ');
    return ` scaled=${scaled.length}/${present.length} (${rates})`;
  }

  /**
   * The voice's eight slots: each stem back in the slot the rifff has it in,
   * at the gain the rifff gives that slot, so the mixer can reach it by slot
   * and the rifff plays at its own mix (LORE's `m_stemGains`).
   */
  function toVoiceStems(
    riff: RiffDocument,
    stems: ResolvedStem[],
    buffers: ReadonlyArray<AudioBufferLike | null>,
  ): (VoiceStem | null)[] {
    const bufferOf = new Map<StemCouchID, AudioBufferLike>();
    stems.forEach((s, i) => {
      const b = buffers[i];
      if (b) bufferOf.set(s.stemId, b);
    });
    return placeStems(riff, stems).map((placed) => {
      const buffer = placed && bufferOf.get(placed.stem.stemId);
      if (!placed || !buffer) return null;
      return { buffer, playbackRate: playbackRateFor(riff, placed.stem), gain: placed.gain };
    });
  }

  /**
   * `length16ths` at the stem's own `bps` is how much audio the document says
   * the file holds. A disagreement with what decoded means a truncated or
   * damaged file — LORE carries `hackAllowStemSizeMismatch` for the same class
   * of damage — and it throws the rifff's timing out.
   */
  function warnOnDeclaredLengthMismatch(
    riffId: RiffCouchID,
    stems: ResolvedStem[],
    buffers: ReadonlyArray<AudioBufferLike | null>,
  ): void {
    const off: string[] = [];
    for (let i = 0; i < buffers.length; i++) {
      const buffer = buffers[i];
      const stem = stems[i];
      if (!buffer || !stem || !(stem.bps > 0) || !(stem.length16ths > 0)) continue;
      const declaredSec = stem.length16ths / 4 / stem.bps;
      // A decoded buffer lands within a block or so of its declared length.
      if (Math.abs(declaredSec - buffer.duration) > Math.max(0.025, declaredSec * 0.01)) {
        off.push(
          `${stem.stemId} (declared ${sec(declaredSec)}, decoded ${sec(buffer.duration)})`,
        );
      }
    }
    if (off.length === 0) return;
    log(
      'warn',
      `rifff ${riffId} has stems whose audio is not the declared length: ${off.join(', ')}`,
    );
  }

  return {
    get state() {
      return state;
    },
    get currentRiffId() {
      return current?.riffId ?? null;
    },
    now() {
      return context.currentTime;
    },

    async warmRiff(jamId, _riff, stems) {
      await Promise.all(stems.map((s) => loader.load(s, jamId)));
    },

    async hopTo(_jamId, riff, stems, hopOpts) {
      const { buffers, missing } = peekBuffers(stems);
      if (missing.length > 0) {
        log(
          'warn',
          `not-ready ${riff.riffId}: ${missing.length}/${stems.length} stems ` +
            `not decoded yet (${missing.join(', ')})`,
        );
        return { kind: 'not-ready', missingStemIds: missing };
      }

      const timing = computeRiffTiming(riff);
      const crossfadeMs = hopOpts?.crossfadeMs ?? defaultCrossfadeMs;
      const crossfadeSec = crossfadeMs / 1000;
      const now = context.currentTime;

      // Cold start — no crossfade needed.
      if (current === null) {
        const voiceStems = toVoiceStems(riff, stems, buffers);
        const voice = createRiffVoice({
          context,
          stems: voiceStems,
          loopDurationSec: timing.loopDurationSec,
          levels: slotLevels,
          destination: master,
        });
        gridOrigin = now;
        voice.start(now, 0);
        warnOnDeclaredLengthMismatch(riff.riffId, stems, buffers);
        warnOnRaggedStems(riff.riffId, stems, buffers, voice.effectiveLoopSec);
        log(
          'debug',
          `start ${riff.riffId} at ${sec(now)} loop=${sec(voice.effectiveLoopSec)} ` +
            `stems=${voice.stemCount} bpm=${timing.bpm.toFixed(2)}` +
            describeScaling(voiceStems),
        );
        current = {
          riffId: riff.riffId,
          voice,
          loopDurationSec: voice.effectiveLoopSec,
          startsAt: now,
        };
        emitRiffChange();
        setState('playing');
        return { kind: 'started', riffId: riff.riffId, whenSec: now, atSec: now };
      }

      // Build the new voice first: the loop it actually plays depends on the
      // stems it holds, and the phase math needs that, not the computed loop.
      const voiceStems = toVoiceStems(riff, stems, buffers);
      const newVoice = createRiffVoice({
        context,
        stems: voiceStems,
        loopDurationSec: timing.loopDurationSec,
        levels: slotLevels,
        destination: master,
      });

      // A beat is a quarter note — the unit `bps` counts.
      const quantiseSec =
        hopOpts?.quantise === 'beat'
          ? 1 / timing.bps
          : hopOpts?.quantise === 'bar'
            ? timing.secPerBar
            : undefined;

      // Hop: pick up at the grid's position, wrapped into the new riff.
      const hop = computeHop({
        now,
        gridOrigin: gridOrigin ?? now,
        newLoopDur: newVoice.effectiveLoopSec,
        crossfadeSec,
        quantiseSec,
      });

      // We start it `crossfadeSec` early so its playhead reaches
      // `offsetInNew` at `startWhen`, the phase-anchor moment. Measured back
      // from `startWhen`, not forward from `now`: a quantised hop is held, and
      // starting at the click would run the crossfade straight away and put
      // the new rifff ahead of the grid by the length of the hold.
      const fadeStart = hop.startWhen - crossfadeSec;
      const callOffset = hop.offsetInNew - crossfadeSec;
      newVoice.start(fadeStart, callOffset);
      newVoice.fadeIn(fadeStart, crossfadeSec);

      // Fade the old voice out over the same window and stop it once the fade
      // has landed. The voice disposes itself when the stop takes effect —
      // disposing here would disconnect it mid-fade and cut the hop dead.
      //
      // Unless the old voice is itself a held hop that hasn't begun by the
      // time this fade starts: a second click inside one hold. Fading it would
      // sound it at full volume (its gain only drops to 0 when its own fade-in
      // begins), so it is stopped before it starts, and the voice it was
      // replacing keeps the fade already scheduled for it.
      const old = current;
      outgoing = outgoing.filter((o) => o.stopAt > now);
      if (old.startsAt >= fadeStart) {
        old.voice.stop(now);
      } else {
        old.voice.fadeOut(fadeStart, crossfadeSec);
        const stopAt = hop.startWhen + 0.01;
        old.voice.stop(stopAt);
        outgoing.push({ voice: old.voice, stopAt });
      }

      warnOnDeclaredLengthMismatch(riff.riffId, stems, buffers);
      warnOnRaggedStems(riff.riffId, stems, buffers, newVoice.effectiveLoopSec);
      log(
        'debug',
        `hop ${old.riffId} → ${riff.riffId} at ${sec(hop.startWhen)} ` +
          `offset=${sec(hop.offsetInNew)} loop=${sec(newVoice.effectiveLoopSec)} ` +
          `prevLoop=${sec(old.loopDurationSec)} stems=${newVoice.stemCount} ` +
          `crossfade=${crossfadeMs}ms` +
          (hopOpts?.quantise === undefined
            ? ''
            : ` quantise=${hopOpts.quantise} +${sec(hop.quantiseDelaySec)}`) +
          describeScaling(voiceStems),
      );

      current = {
        riffId: riff.riffId,
        voice: newVoice,
        loopDurationSec: newVoice.effectiveLoopSec,
        startsAt: fadeStart,
      };
      emitRiffChange();
      setState('playing');
      return {
        kind: 'phase-locked',
        riffId: riff.riffId,
        whenSec: hop.startWhen,
        offsetSec: hop.offsetInNew,
        atSec: now,
      };
    },

    stop() {
      // Outgoing voices already have a stop scheduled; disconnecting silences
      // them now, which is what Stop means.
      for (const o of outgoing) o.voice.dispose();
      outgoing = [];
      if (current === null) {
        setState('idle');
        return;
      }
      const stopAt = context.currentTime;
      current.voice.stop(stopAt);
      current.voice.dispose();
      current = null;
      gridOrigin = null;
      emitRiffChange();
      setState('idle');
    },

    get slotLevels() {
      return slotLevels;
    },

    playhead() {
      if (current === null || gridOrigin === null) return null;
      const loopSec = current.loopDurationSec;
      if (!(loopSec > 0)) return null;
      const since = context.currentTime - gridOrigin;
      return { riffId: current.riffId, positionSec: ((since % loopSec) + loopSec) % loopSec, loopSec };
    },

    levels() {
      if (meters.length < 2) return [0, 0];
      const peak = ({ node, frame }: (typeof meters)[number]) => {
        node.getFloatTimeDomainData(frame);
        let max = 0;
        for (const v of frame) max = Math.max(max, Math.abs(v));
        return Math.min(1, max);
      };
      return [peak(meters[0]!), peak(meters[1]!)];
    },

    setSlotLevels(levels) {
      slotLevels = Array.from({ length: SLOT_COUNT }, (_, i) => {
        const l = levels[i];
        return l !== undefined && Number.isFinite(l) ? Math.max(0, l) : 1;
      });
      // The rifff playing and any still fading out follow the fader at once.
      const now = context.currentTime;
      for (const v of [current?.voice, ...outgoing.map((o) => o.voice)]) {
        if (!v) continue;
        slotLevels.forEach((level, slot) => v.setSlotLevel(slot, level, now));
      }
    },

    onStateChange(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    onRiffChange(fn) {
      riffListeners.add(fn);
      return () => {
        riffListeners.delete(fn);
      };
    },
  };
}
