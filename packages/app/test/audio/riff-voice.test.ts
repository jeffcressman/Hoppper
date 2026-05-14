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

function buf(label = 'b'): AudioBufferLike {
  return {
    length: 100,
    numberOfChannels: 2,
    sampleRate: 48000,
    duration: 0.002,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({ _label: label } as any),
  };
}

describe('createRiffVoice', () => {
  it('creates one BufferSource per non-null slot and a single shared GainNode', () => {
    const ctx = createMockContext();
    const buffers = [buf('a'), null, buf('c'), null, buf('e'), null, null, buf('h')];
    const voice = createRiffVoice({ context: ctx, buffers, loopDurationSec: 8 });

    expect(ctx.sources.length).toBe(4);
    expect(ctx.gains.length).toBe(1);
    expect(voice.stemCount).toBe(4);
  });

  it('routes every source through the gain to the destination', () => {
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      buffers: [buf(), buf(), buf(), buf(), null, null, null, null],
      loopDurationSec: 4,
    });
    void voice;

    const gain = ctx.gains[0]!;
    for (const src of ctx.sources) {
      expect(src.connections).toContain(gain);
    }
    expect(gain.connections).toContain(ctx.destination);
  });

  it('enables looping over [0, loopDurationSec] on every source', () => {
    const ctx = createMockContext();
    createRiffVoice({
      context: ctx,
      buffers: [buf(), buf(), null, null, null, null, null, null],
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
      buffers: [buf(), buf(), buf(), null, null, null, null, null],
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
      buffers: [buf(), null, null, null, null, null, null, null],
      loopDurationSec: 4,
    });
    voice.start(0, 0);
    expect(() => voice.start(1, 0)).toThrow();
  });

  it('fadeIn schedules a 0 → 1 linear ramp on the gain param', () => {
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      buffers: [buf(), null, null, null, null, null, null, null],
      loopDurationSec: 4,
    });
    voice.fadeIn(3.0, 0.25);
    const events = (ctx.gains[0] as MockGain).param.events;
    expect(events[0]).toEqual({ kind: 'set', value: 0, time: 3.0 });
    expect(events[1]).toEqual({ kind: 'ramp', value: 1, time: 3.25 });
  });

  it('fadeOut schedules a current → 0 linear ramp ending at startTime + durationSec', () => {
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      buffers: [buf(), null, null, null, null, null, null, null],
      loopDurationSec: 4,
    });
    voice.fadeOut(5.0, 0.25);
    const events = (ctx.gains[0] as MockGain).param.events;
    // Anchors current value at startTime so the ramp starts from a defined point.
    expect(events[0]?.kind).toBe('set');
    expect(events[0]?.time).toBe(5.0);
    expect(events[1]).toEqual({ kind: 'ramp', value: 0, time: 5.25 });
  });

  it('stop(when) stops every source at `when`', () => {
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      buffers: [buf(), buf(), null, null, null, null, null, null],
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
      buffers: [buf(), buf(), null, null, null, null, null, null],
      loopDurationSec: 8,
    });
    voice.dispose();
    for (const src of ctx.sources) {
      expect(src.disconnected).toBe(true);
    }
    expect((ctx.gains[0] as MockGain).disconnected).toBe(true);
  });

  it('handles a riff with all null slots (silent voice) — no sources created', () => {
    const ctx = createMockContext();
    const voice = createRiffVoice({
      context: ctx,
      buffers: [null, null, null, null, null, null, null, null],
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
