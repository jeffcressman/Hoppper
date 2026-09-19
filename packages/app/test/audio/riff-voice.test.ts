import { describe, it, expect, vi } from 'vitest';
import type { AudioBufferLike } from '../../src/audio/audio-buffer-cache.js';
import {
  createRiffVoice,
  type AudioContextLike,
  type AudioBufferSourceLike,
  type GainNodeLike,
  type AudioParamLike,
} from '../../src/audio/riff-voice.js';

interface MockNodeRecord {
  sources: MockSource[];
  gains: MockGain[];
}

interface MockParam extends AudioParamLike {
  events: { kind: 'set' | 'ramp' | 'cancel'; value?: number; time: number }[];
}

interface MockSource extends AudioBufferSourceLike {
  startedAt?: { when: number; offset: number };
  stoppedAt?: number;
  connections: object[];
  disconnected: boolean;
}

interface MockGain extends GainNodeLike {
  connections: object[];
  disconnected: boolean;
  param: MockParam;
}

function createMockContext(): AudioContextLike & MockNodeRecord {
  const sources: MockSource[] = [];
  const gains: MockGain[] = [];
  const destination = {} as object;

  function makeParam(initial: number): MockParam {
    return {
      value: initial,
      events: [],
      setValueAtTime(value, when) {
        this.events.push({ kind: 'set', value, time: when });
      },
      linearRampToValueAtTime(value, when) {
        this.events.push({ kind: 'ramp', value, time: when });
      },
      cancelScheduledValues(when) {
        this.events.push({ kind: 'cancel', time: when });
      },
    };
  }

  const ctx: AudioContextLike & MockNodeRecord = {
    currentTime: 0,
    destination,
    sources,
    gains,
    createBufferSource() {
      const src: MockSource = {
        buffer: null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        playbackRate: makeParam(1),
        onended: null,
        connections: [],
        disconnected: false,
        start: vi.fn(function (this: MockSource, when = 0, offset = 0) {
          this.startedAt = { when, offset };
        }),
        stop: vi.fn(function (this: MockSource, when = 0) {
          this.stoppedAt = when;
        }),
        connect(dest: object) {
          this.connections.push(dest);
        },
        disconnect() {
          this.disconnected = true;
        },
      };
      sources.push(src);
      return src;
    },
    createGain() {
      const g: MockGain = {
        param: makeParam(1),
        get gain() {
          return this.param;
        },
        connections: [],
        disconnected: false,
        connect(dest: object) {
          this.connections.push(dest);
        },
        disconnect() {
          this.disconnected = true;
        },
      };
      gains.push(g);
      return g;
    },
  };

  return ctx;
}

// Stems are real recordings — default to one comfortably longer than the
// riff loops used below so tests that don't care about length aren't
// accidentally exercising the buffer-shorter-than-loop path.
function buf(label = 'b', duration = 32): AudioBufferLike {
  return {
    length: Math.round(duration * 48000),
    numberOfChannels: 2,
    sampleRate: 48000,
    duration,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({ _label: label } as any),
  };
}

describe('createRiffVoice', () => {
  // The voice's own gain (fades) is the one wired to the destination; each
  // stem also has a gain of its own, for its level in the mix.
  const voiceGainOf = (ctx: ReturnType<typeof createMockContext>) =>
    ctx.gains.find((g) => g.connections.includes(ctx.destination))!;
  const stemGainOf = (src: MockSource) => src.connections[0] as MockGain;

  it('creates one BufferSource per non-null slot, each with its own gain, and one voice gain', () => {
    const ctx = createMockContext();
    const stems = [{ buffer: buf('a') }, null, { buffer: buf('c') }, null, { buffer: buf('e') }, null, null, { buffer: buf('h') }];
    const voice = createRiffVoice({ context: ctx, stems, loopDurationSec: 8 });

    expect(ctx.sources.length).toBe(4);
    expect(ctx.gains.length).toBe(5);
    expect(voice.stemCount).toBe(4);
  });

  it('routes every source through its stem gain, then the voice gain, to the destination', () => {
    const ctx = createMockContext();
    createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf() }, { buffer: buf() }, { buffer: buf() }, { buffer: buf() }, null, null, null, null],
      loopDurationSec: 4,
    });

    const voiceGain = voiceGainOf(ctx);
    for (const src of ctx.sources) {
      const stemGain = stemGainOf(src);
      expect(stemGain).not.toBe(voiceGain);
      expect(stemGain.connections).toContain(voiceGain);
    }
  });

  it('plays each stem at the gain the rifff gives its slot (LORE: m_stemGains)', () => {
    const ctx = createMockContext();
    createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf(), gain: 0.5 }, null, { buffer: buf(), gain: 0.8 }, null, null, null, null, null],
      loopDurationSec: 4,
    });
    expect(ctx.sources.map((s) => stemGainOf(s).gain.value)).toEqual([0.5, 0.8]);
  });

  it('starts each stem at its mixer level times the rifff’s gain', () => {
    const ctx = createMockContext();
    createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf(), gain: 0.5 }, { buffer: buf(), gain: 1 }, null, null, null, null, null, null],
      loopDurationSec: 4,
      levels: [0.5, 0, 1, 1, 1, 1, 1, 1],
    });
    expect(ctx.sources.map((s) => stemGainOf(s).gain.value)).toEqual([0.25, 0]);
  });

  it('setSlotLevel glides one slot to its new level, leaving the others alone', () => {
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf(), gain: 0.5 }, { buffer: buf(), gain: 1 }, null, null, null, null, null, null],
      loopDurationSec: 4,
    });
    voice.setSlotLevel(0, 0.4, 10);
    const moved = stemGainOf(ctx.sources[0]!).param.events;
    // A short glide rather than a jump, so a fader move doesn't click.
    expect(moved).toEqual([
      { kind: 'cancel', time: 10 },
      { kind: 'set', value: 0.5, time: 10 },
      { kind: 'ramp', value: 0.2, time: 10.02 },
    ]);
    expect(stemGainOf(ctx.sources[1]!).param.events).toEqual([]);
  });

  it('setSlotLevel on an empty slot does nothing', () => {
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf() }, null, null, null, null, null, null, null],
      loopDurationSec: 4,
    });
    expect(() => voice.setSlotLevel(3, 0, 1)).not.toThrow();
  });

  it('enables looping from the start of every source', () => {
    const ctx = createMockContext();
    createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf('a', 12) }, { buffer: buf('b', 12) }, null, null, null, null, null, null],
      loopDurationSec: 12,
    });
    for (const src of ctx.sources) {
      expect(src.loop).toBe(true);
      expect(src.loopStart).toBe(0);
      expect(src.loopEnd).toBe(12);
    }
  });

  it('start(when, offset) starts every source at the same (when, offset)', () => {
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf() }, { buffer: buf() }, { buffer: buf() }, null, null, null, null, null],
      loopDurationSec: 8,
    });
    voice.start(2.5, 1.25);
    for (const src of ctx.sources) {
      expect(src.startedAt).toEqual({ when: 2.5, offset: 1.25 });
    }
  });

  it('start is a one-shot — calling it twice throws', () => {
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf() }, null, null, null, null, null, null, null],
      loopDurationSec: 4,
    });
    voice.start(0, 0);
    expect(() => voice.start(1, 0)).toThrow();
  });

  it('loops each source at its own stem length, short or long', () => {
    // LORE (live.riff.cpp): a stem shorter than the riff repeats inside it,
    // and a stem longer than the computed riff length pushes the riff length
    // out rather than being truncated. Either way each stem loops at its own
    // length — Web Audio would otherwise loop a short stem at its buffer end
    // while we computed offsets against a different number.
    const ctx = createMockContext();
    createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf('short', 4) }, { buffer: buf('exact', 16) }, { buffer: buf('long', 24) }, null, null, null, null, null],
      loopDurationSec: 16,
    });
    expect(ctx.sources[0]?.loopEnd).toBe(4);
    expect(ctx.sources[1]?.loopEnd).toBe(16);
    expect(ctx.sources[2]?.loopEnd).toBe(24);
  });

  it('wraps the start offset into each stem own loop length', () => {
    // A 4s stem asked to start 9.2s in must land at 1.2s — its position in
    // the same grid — not be clamped to its end by the browser.
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf('short', 4) }, { buffer: buf('long', 16) }, null, null, null, null, null, null],
      loopDurationSec: 16,
    });
    voice.start(2.5, 9.2);
    expect(ctx.sources[0]?.startedAt?.when).toBe(2.5);
    expect(ctx.sources[0]?.startedAt?.offset).toBeCloseTo(1.2, 6);
    expect(ctx.sources[1]?.startedAt?.offset).toBeCloseTo(9.2, 6);
  });

  it('plays a stem recorded at another tempo at the rifff tempo', () => {
    // LORE live.riff.cpp: stemTimeScale = riff.BPS / stem.BPS, applied to the
    // stem's samples. A stem cut at 120bpm reused by a 144bpm rifff plays 1.2×
    // as fast, so its 8s of audio occupies 6.667s of the rifff.
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf('borrowed', 8), playbackRate: 1.2 }, null, null, null, null, null, null, null],
      loopDurationSec: 6.6667,
    });
    expect(ctx.sources[0]?.playbackRate.value).toBeCloseTo(1.2, 6);
    // loopEnd is in buffer time, so it stays the stem's own length.
    expect(ctx.sources[0]?.loopEnd).toBeCloseTo(8, 6);
    // The loop it occupies in rifff time is the scaled length.
    expect(voice.effectiveLoopSec).toBeCloseTo(8 / 1.2, 4);
  });

  it('converts a rifff-time start offset into buffer time for a scaled stem', () => {
    // 8s of audio at rate 2 occupies 4s of the rifff. Asked to start 5s in
    // (rifff time) it wraps to 1s, which is 2s into the buffer.
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf('fast', 8), playbackRate: 2 }, null, null, null, null, null, null, null],
      loopDurationSec: 4,
    });
    voice.start(0, 5);
    expect(ctx.sources[0]?.startedAt?.offset).toBeCloseTo(2, 6);
  });

  it('defaults to rate 1 when a stem is at the rifff tempo', () => {
    const ctx = createMockContext();
    createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf('b', 8) }, null, null, null, null, null, null, null],
      loopDurationSec: 8,
    });
    expect(ctx.sources[0]?.playbackRate.value).toBe(1);
  });

  it('ignores an unusable playback rate rather than throwing', () => {
    // A stem document with bps 0 would produce Infinity here; a non-finite
    // playbackRate throws, taking the voice down mid-hop.
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      stems: [
        { buffer: buf('b', 8), playbackRate: Number.POSITIVE_INFINITY },
        { buffer: buf('c', 8), playbackRate: 0 },
        null,
        null,
        null,
        null,
        null,
        null,
      ],
      loopDurationSec: 8,
    });
    expect(ctx.sources[0]?.playbackRate.value).toBe(1);
    expect(ctx.sources[1]?.playbackRate.value).toBe(1);
    expect(voice.effectiveLoopSec).toBeCloseTo(8, 6);
  });

  it('falls back to the stem own length when the riff loop is unusable', () => {
    // Damaged riff timing (bps of 0 or NaN) must not take the hop down with
    // it: a non-finite loopEnd or offset throws, which would leave the rest
    // of the voice unscheduled and still connected.
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf('b', 8) }, null, null, null, null, null, null, null],
      loopDurationSec: Number.NaN,
    });
    expect(voice.effectiveLoopSec).toBe(8);
    expect(ctx.sources[0]?.loopEnd).toBe(8);
    voice.start(1, 12);
    expect(ctx.sources[0]?.startedAt).toEqual({ when: 1, offset: 4 });
  });

  it('reports effectiveLoopSec as the computed loop, pushed out to fit the longest stem', () => {
    // Mirrors LORE: m_lengthInSec = max(computed, longest stem). Short stems
    // repeat inside the riff, so they never shorten it.
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf('short', 4) }, { buffer: buf('mid', 8) }, null, null, null, null, null, null],
      loopDurationSec: 16,
    });
    expect(voice.effectiveLoopSec).toBeCloseTo(16, 6);

    const ctx2 = createMockContext();
    const voice2 = createRiffVoice({
      context: ctx2,
      stems: [{ buffer: buf('long', 32) }, null, null, null, null, null, null, null],
      loopDurationSec: 16,
    });
    expect(voice2.effectiveLoopSec).toBeCloseTo(32, 6);
  });

  it('effectiveLoopSec falls back to the riff loop for a silent voice', () => {
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      stems: [null, null, null, null, null, null, null, null],
      loopDurationSec: 12,
    });
    expect(voice.effectiveLoopSec).toBeCloseTo(12, 6);
  });

  it('tears itself down once every stopped source has ended', () => {
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf() }, { buffer: buf() }, null, null, null, null, null, null],
      loopDurationSec: 8,
    });
    voice.start(0, 0);
    voice.stop(2.5);

    // Still connected: the crossfade is still running until `when`.
    expect(ctx.sources.every((s) => !s.disconnected)).toBe(true);
    expect((ctx.gains[0] as MockGain).disconnected).toBe(false);

    // The browser fires onended per source when the scheduled stop lands.
    for (const src of ctx.sources) src.onended?.({} as Event);

    expect(ctx.sources.every((s) => s.disconnected)).toBe(true);
    expect((ctx.gains[0] as MockGain).disconnected).toBe(true);
  });

  it('does not tear down until the last source has ended', () => {
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf() }, { buffer: buf() }, null, null, null, null, null, null],
      loopDurationSec: 8,
    });
    voice.start(0, 0);
    voice.stop(1);
    ctx.sources[0]?.onended?.({} as Event);
    expect((ctx.gains[0] as MockGain).disconnected).toBe(false);
    ctx.sources[1]?.onended?.({} as Event);
    expect((ctx.gains[0] as MockGain).disconnected).toBe(true);
  });

  it('stop() on a silent voice tears down immediately (no sources to end)', () => {
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      stems: [null, null, null, null, null, null, null, null],
      loopDurationSec: 4,
    });
    voice.start(0, 0);
    voice.stop(1);
    expect((ctx.gains[0] as MockGain).disconnected).toBe(true);
  });

  it('fadeIn schedules a 0 → 1 linear ramp on the gain param', () => {
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf() }, null, null, null, null, null, null, null],
      loopDurationSec: 4,
    });
    voice.fadeIn(3.0, 0.25);
    const events = (ctx.gains[0] as MockGain).param.events;
    // Pending automation is dropped first, so a fade started mid-fade can't
    // be overtaken by the ramp it replaces.
    expect(events[0]).toEqual({ kind: 'cancel', time: 3.0 });
    expect(events[1]).toEqual({ kind: 'set', value: 0, time: 3.0 });
    expect(events[2]).toEqual({ kind: 'ramp', value: 1, time: 3.25 });
  });

  it('fadeOut schedules a current → 0 linear ramp ending at startTime + durationSec', () => {
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf() }, null, null, null, null, null, null, null],
      loopDurationSec: 4,
    });
    voice.fadeOut(5.0, 0.25);
    const events = (ctx.gains[0] as MockGain).param.events;
    // Cancel first, then anchor the current value at startTime so the ramp
    // starts from a defined point and nothing scheduled earlier can raise it
    // again on the way down.
    expect(events[0]).toEqual({ kind: 'cancel', time: 5.0 });
    expect(events[1]?.kind).toBe('set');
    expect(events[1]?.time).toBe(5.0);
    expect(events[2]).toEqual({ kind: 'ramp', value: 0, time: 5.25 });
  });

  it('stop(when) stops every source at `when`', () => {
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf() }, { buffer: buf() }, null, null, null, null, null, null],
      loopDurationSec: 8,
    });
    voice.start(0, 0);
    voice.stop(2.5);
    for (const src of ctx.sources) {
      expect(src.stoppedAt).toBe(2.5);
    }
  });

  it('dispose() disconnects every source and the gain node', () => {
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      stems: [{ buffer: buf() }, { buffer: buf() }, null, null, null, null, null, null],
      loopDurationSec: 8,
    });
    voice.dispose();
    for (const src of ctx.sources) {
      expect(src.disconnected).toBe(true);
    }
    // Every gain: the voice's and each stem's.
    expect(ctx.gains.every((g) => g.disconnected)).toBe(true);
  });

  it('handles a riff with all null slots (silent voice) — no sources created', () => {
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      stems: [null, null, null, null, null, null, null, null],
      loopDurationSec: 4,
    });
    expect(voice.stemCount).toBe(0);
    expect(ctx.sources.length).toBe(0);
    expect(ctx.gains.length).toBe(1);
    expect(() => voice.start(0, 0)).not.toThrow();
    expect(() => voice.stop(1)).not.toThrow();
    expect(() => voice.dispose()).not.toThrow();
  });
});
