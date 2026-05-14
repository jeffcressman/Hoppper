import { describe, it, expect, vi } from 'vitest';
import type {
  JamCouchID,
  ResolvedStem,
  RiffCouchID,
  RiffDocument,
  StemCouchID,
} from '@hoppper/sdk';
import { createAudioEngine } from '../../src/audio/engine.js';
import type {
  AudioContextLike,
  AudioBufferSourceLike,
  GainNodeLike,
} from '../../src/audio/riff-voice.js';
import type { AudioBufferLike } from '../../src/audio/audio-buffer-cache.js';
import type { StemLoader } from '../../src/audio/stem-loader.js';

const JAM = 'band-test' as JamCouchID;

function riff(id: string, overrides: Partial<RiffDocument> = {}): RiffDocument {
  return {
    riffId: id as RiffCouchID,
    jamId: JAM,
    userName: 'u',
    createdAt: 0,
    bps: 2,
    bpm: 120,
    barLength: 16, // → 2s/bar, 8 bars, 16s loop
    root: 0,
    scale: 0,
    slots: [],
    ...overrides,
  };
}

function stem(id: string): ResolvedStem {
  return {
    stemId: id as StemCouchID,
    format: 'ogg',
    url: `https://cdn.example/${id}.ogg`,
    length: 4,
    mime: 'audio/ogg',
  };
}

function fakeBuffer(): AudioBufferLike {
  return { length: 100, numberOfChannels: 2, sampleRate: 48000, duration: 0.002 };
}

interface MockSource extends AudioBufferSourceLike {
  startedAt?: { when: number; offset: number };
  stoppedAt?: number;
}
interface MockGain extends GainNodeLike {
  events: { kind: string; value?: number; time: number }[];
}
interface MockCtx extends AudioContextLike {
  currentTime: number;
  sources: MockSource[];
  gains: MockGain[];
}

function createMockContext(): MockCtx {
  const sources: MockSource[] = [];
  const gains: MockGain[] = [];
  const destination = {};
  const ctx: MockCtx = {
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
        start: vi.fn(function (this: MockSource, when = 0, offset = 0) {
          this.startedAt = { when, offset };
        }),
        stop: vi.fn(function (this: MockSource, when = 0) {
          this.stoppedAt = when;
        }),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      sources.push(src);
      return src;
    },
    createGain() {
      const events: { kind: string; value?: number; time: number }[] = [];
      const param = {
        value: 1,
        setValueAtTime(v: number, t: number) {
          events.push({ kind: 'set', value: v, time: t });
        },
        linearRampToValueAtTime(v: number, t: number) {
          events.push({ kind: 'ramp', value: v, time: t });
        },
        cancelScheduledValues(t: number) {
          events.push({ kind: 'cancel', time: t });
        },
      };
      const g: MockGain = {
        events,
        gain: param,
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gains.push(g);
      return g;
    },
  };
  return ctx;
}

function mockLoader(initialBuffers: Map<StemCouchID, AudioBufferLike>): StemLoader {
  return {
    peek: vi.fn((id: StemCouchID) => initialBuffers.get(id)),
    load: vi.fn(async (s: ResolvedStem) => {
      let b = initialBuffers.get(s.stemId);
      if (!b) {
        b = fakeBuffer();
        initialBuffers.set(s.stemId, b);
      }
      return b;
    }),
  };
}

describe('createAudioEngine', () => {
  it('starts in idle state with no current riff', () => {
    const ctx = createMockContext();
    const loader = mockLoader(new Map());
    const engine = createAudioEngine({ context: ctx, loader });
    expect(engine.state).toBe('idle');
    expect(engine.currentRiffId).toBeNull();
  });

  it('now() returns context.currentTime', () => {
    const ctx = createMockContext();
    ctx.currentTime = 7.5;
    const engine = createAudioEngine({ context: ctx, loader: mockLoader(new Map()) });
    expect(engine.now()).toBe(7.5);
  });

  it('hopTo when nothing playing: starts the riff at now, state→playing', async () => {
    const ctx = createMockContext();
    ctx.currentTime = 10;
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['s1' as StemCouchID, fakeBuffer()],
      ['s2' as StemCouchID, fakeBuffer()],
    ]);
    const engine = createAudioEngine({ context: ctx, loader: mockLoader(buffers) });
    const r = riff('r1');
    const result = await engine.hopTo(JAM, r, [stem('s1'), stem('s2')]);

    expect(result.kind).toBe('started');
    if (result.kind === 'started') {
      expect(result.riffId).toBe('r1');
      expect(result.whenSec).toBeCloseTo(10, 6);
    }
    expect(engine.state).toBe('playing');
    expect(engine.currentRiffId).toBe('r1');
    // 2 sources for r1, started at now with offset 0.
    expect(ctx.sources.length).toBe(2);
    for (const src of ctx.sources) {
      expect(src.startedAt?.when).toBeCloseTo(10, 6);
      expect(src.startedAt?.offset).toBeCloseTo(0, 6);
    }
  });

  it('hopTo returns not-ready when any stem buffer is missing', async () => {
    const ctx = createMockContext();
    const loader = mockLoader(new Map()); // empty — peek will miss
    const engine = createAudioEngine({ context: ctx, loader });
    const result = await engine.hopTo(JAM, riff('r1'), [stem('s1'), stem('s2')]);
    expect(result.kind).toBe('not-ready');
    if (result.kind === 'not-ready') {
      expect(result.missingStemIds).toContain('s1');
      expect(result.missingStemIds).toContain('s2');
    }
    expect(engine.state).toBe('idle');
    expect(ctx.sources.length).toBe(0);
  });

  it('hopTo while playing: phase-locks and crossfades', async () => {
    const ctx = createMockContext();
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['a' as StemCouchID, fakeBuffer()],
      ['b' as StemCouchID, fakeBuffer()],
    ]);
    const engine = createAudioEngine({
      context: ctx,
      loader: mockLoader(buffers),
      defaultCrossfadeMs: 250,
    });

    ctx.currentTime = 0;
    await engine.hopTo(JAM, riff('r1'), [stem('a')]);
    expect(engine.state).toBe('playing');
    expect(ctx.sources.length).toBe(1);

    // Advance the clock 4 seconds (so prev is 4s into its 16s loop).
    ctx.currentTime = 4;
    const result = await engine.hopTo(JAM, riff('r2'), [stem('b')]);
    expect(result.kind).toBe('phase-locked');
    if (result.kind === 'phase-locked') {
      expect(result.riffId).toBe('r2');
      // Phase-lock should land near 4 + 0.25 = 4.25s into the new loop.
      expect(result.offsetSec).toBeCloseTo(4.25, 5);
    }
    expect(engine.currentRiffId).toBe('r2');
    expect(ctx.sources.length).toBe(2); // r1's source + r2's source
  });

  it('stop() halts all voices and returns to idle', async () => {
    const ctx = createMockContext();
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['s1' as StemCouchID, fakeBuffer()],
    ]);
    const engine = createAudioEngine({ context: ctx, loader: mockLoader(buffers) });
    ctx.currentTime = 5;
    await engine.hopTo(JAM, riff('r1'), [stem('s1')]);
    expect(engine.state).toBe('playing');

    engine.stop();
    expect(engine.state).toBe('idle');
    expect(engine.currentRiffId).toBeNull();
    expect(ctx.sources[0]?.stoppedAt).toBeDefined();
  });

  it('onStateChange fires when state transitions occur', async () => {
    const ctx = createMockContext();
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['s1' as StemCouchID, fakeBuffer()],
    ]);
    const engine = createAudioEngine({ context: ctx, loader: mockLoader(buffers) });
    const cb = vi.fn();
    const unsub = engine.onStateChange(cb);

    await engine.hopTo(JAM, riff('r1'), [stem('s1')]);
    expect(cb).toHaveBeenCalledWith('playing');

    engine.stop();
    expect(cb).toHaveBeenCalledWith('idle');

    unsub();
    cb.mockClear();
    engine.stop();
    expect(cb).not.toHaveBeenCalled();
  });

  it('warmRiff calls loader.load for each stem', async () => {
    const ctx = createMockContext();
    const loader = mockLoader(new Map());
    const engine = createAudioEngine({ context: ctx, loader });
    await engine.warmRiff(JAM, riff('r1'), [stem('s1'), stem('s2'), stem('s3')]);
    expect(loader.load).toHaveBeenCalledTimes(3);
  });
});
