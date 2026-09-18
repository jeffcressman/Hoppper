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
    byteLength: 4,
    mime: 'audio/ogg',
    // Matches riff()'s bps and a 16s loop, so nothing is rate-scaled unless a
    // test says so.
    bps: 2,
    length16ths: 128,
  };
}

// The riffs above compute a 16s loop, so give stems a duration that actually
// holds it — a stem shorter than the loop is a distinct case (see riff-voice).
function fakeBuffer(duration = 16): AudioBufferLike {
  return {
    length: Math.round(duration * 48000),
    numberOfChannels: 2,
    sampleRate: 48000,
    duration,
  };
}

interface MockSource extends AudioBufferSourceLike {
  startedAt?: { when: number; offset: number };
  stoppedAt?: number;
  disconnected: boolean;
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
        playbackRate: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} },
        disconnected: false,
        start: vi.fn(function (this: MockSource, when = 0, offset = 0) {
          this.startedAt = { when, offset };
        }),
        stop: vi.fn(function (this: MockSource, when = 0) {
          this.stoppedAt = when;
        }),
        connect: vi.fn(),
        disconnect: vi.fn(function (this: MockSource) {
          this.disconnected = true;
        }),
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

  it('reports every change of current rifff, not just idle ↔ playing', async () => {
    // State stays 'playing' across a hop, so onStateChange is silent there —
    // anything showing which rifff is playing needs this instead.
    const ctx = createMockContext();
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['a' as StemCouchID, fakeBuffer()],
      ['b' as StemCouchID, fakeBuffer()],
    ]);
    const engine = createAudioEngine({ context: ctx, loader: mockLoader(buffers) });
    const seen: (string | null)[] = [];
    engine.onRiffChange((id) => seen.push(id));

    await engine.hopTo(JAM, riff('r1'), [stem('a')]);
    ctx.currentTime = 4;
    await engine.hopTo(JAM, riff('r2'), [stem('b')]);
    // A not-ready hop changes nothing.
    await engine.hopTo(JAM, riff('r3'), [stem('missing')]);
    engine.stop();

    expect(seen).toEqual(['r1', 'r2', null]);
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

  it('keeps the outgoing voice audible for the whole crossfade, then disposes it', async () => {
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
    ctx.currentTime = 4;
    await engine.hopTo(JAM, riff('r2'), [stem('b')]);
    // Anything queued on the microtask queue has run by now.
    await Promise.resolve();
    await Promise.resolve();

    const outgoing = ctx.sources[0]!;
    // Still connected — the fade to 0 hasn't landed yet.
    expect(outgoing.disconnected).toBe(false);
    // Stopped just after the crossfade completes, not before.
    expect(outgoing.stoppedAt).toBeGreaterThanOrEqual(4.25);

    // When the browser reports the stop, the voice tears itself down.
    outgoing.onended?.({});
    expect(outgoing.disconnected).toBe(true);
  });

  it('measures every hop from the grid origin, not from the previous hop', async () => {
    // The recorded off-beat session, replayed: cold start then four hops, all
    // 8s loops. Each offset must be the position on the grid — elapsed since
    // the cold start — not the time since the last hop.
    const ctx = createMockContext();
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['a' as StemCouchID, fakeBuffer(8)],
      ['b' as StemCouchID, fakeBuffer(8)],
    ]);
    const engine = createAudioEngine({
      context: ctx,
      loader: mockLoader(buffers),
      defaultCrossfadeMs: 0,
    });
    const r = (id: string) => riff(id, { bps: 2, barLength: 8 }); // → 8s loop

    ctx.currentTime = 29.5;
    await engine.hopTo(JAM, r('r1'), [stem('a')]);

    const offsets: number[] = [];
    for (const [when, stemId] of [
      [31.67, 'b'],
      [33.6, 'a'],
      [35.86, 'b'],
      [38.42, 'a'],
    ] as const) {
      ctx.currentTime = when;
      const result = await engine.hopTo(JAM, r(`riff-${when}`), [stem(stemId)]);
      if (result.kind !== 'phase-locked') throw new Error(`expected a hop, got ${result.kind}`);
      offsets.push(result.offsetSec);
    }

    expect(offsets[0]).toBeCloseTo(2.17, 2);
    expect(offsets[1]).toBeCloseTo(4.1, 2);
    expect(offsets[2]).toBeCloseTo(6.36, 2);
    expect(offsets[3]).toBeCloseTo(0.92, 2);
  });

  it('quantised entry holds the hop until the next beat on the grid', async () => {
    const ctx = createMockContext();
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['a' as StemCouchID, fakeBuffer()],
      ['b' as StemCouchID, fakeBuffer()],
    ]);
    const engine = createAudioEngine({
      context: ctx,
      loader: mockLoader(buffers),
      defaultCrossfadeMs: 0,
    });

    // riff() is 2 bps → 0.5s beats, 2s bars.
    ctx.currentTime = 0;
    await engine.hopTo(JAM, riff('r1'), [stem('a')]);
    ctx.currentTime = 4.1;
    const result = await engine.hopTo(JAM, riff('r2'), [stem('b')], { quantise: 'beat' });

    if (result.kind !== 'phase-locked') throw new Error('expected a hop');
    expect(result.whenSec).toBeCloseTo(4.5, 6);
    expect(result.offsetSec).toBeCloseTo(4.5, 6);
  });

  it('quantised entry can hold for a whole bar instead', async () => {
    const ctx = createMockContext();
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['a' as StemCouchID, fakeBuffer()],
      ['b' as StemCouchID, fakeBuffer()],
    ]);
    const engine = createAudioEngine({
      context: ctx,
      loader: mockLoader(buffers),
      defaultCrossfadeMs: 0,
    });

    ctx.currentTime = 0;
    await engine.hopTo(JAM, riff('r1'), [stem('a')]);
    ctx.currentTime = 4.1;
    const result = await engine.hopTo(JAM, riff('r2'), [stem('b')], { quantise: 'bar' });

    if (result.kind !== 'phase-locked') throw new Error('expected a hop');
    expect(result.whenSec).toBeCloseTo(6, 6);
  });

  it('stop() silences a rifff that is still fading out, not just the current one', async () => {
    // A quantised hop keeps the outgoing rifff sounding until the held moment
    // — up to a bar. Stop pressed in that window must silence it too.
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
    ctx.currentTime = 4.1;
    await engine.hopTo(JAM, riff('r2'), [stem('b')], { quantise: 'bar' });
    engine.stop();

    for (const src of ctx.sources) expect(src.disconnected).toBe(true);
  });

  it('a hop clicked during a hold replaces the held rifff before it sounds', async () => {
    // Two clicks inside one hold both land on the same beat. The first
    // incoming rifff never gets to sound: the outgoing one fades straight
    // into the second, rather than the first cutting in at full volume.
    const ctx = createMockContext();
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['a' as StemCouchID, fakeBuffer()],
      ['b' as StemCouchID, fakeBuffer()],
      ['c' as StemCouchID, fakeBuffer()],
    ]);
    const engine = createAudioEngine({
      context: ctx,
      loader: mockLoader(buffers),
      defaultCrossfadeMs: 250,
    });

    ctx.currentTime = 0;
    await engine.hopTo(JAM, riff('r1'), [stem('a')]);
    ctx.currentTime = 4.1;
    await engine.hopTo(JAM, riff('r2'), [stem('b')], { quantise: 'beat' });
    ctx.currentTime = 4.15;
    await engine.hopTo(JAM, riff('r3'), [stem('c')], { quantise: 'beat' });

    const [first, held, second] = ctx.sources;
    // The held rifff is stopped at the click, before its 4.25 start.
    expect(held!.stoppedAt).toBeCloseTo(4.15, 6);
    expect(held!.stoppedAt!).toBeLessThan(held!.startedAt!.when);
    // Its gain is left alone — fading it out would sound it at full volume.
    expect(ctx.gains[1]!.events.filter((e) => e.kind === 'ramp')).toEqual([
      { kind: 'ramp', value: 1, time: 4.5 },
    ]);
    // The first rifff keeps its fade to the held beat; the new one fades in
    // over the same window.
    expect(first!.stoppedAt).toBeCloseTo(4.51, 6);
    expect(second!.startedAt?.when).toBeCloseTo(4.25, 6);
    expect(engine.currentRiffId).toBe('r3');

    // And Stop still reaches everything that could sound.
    engine.stop();
    expect(first!.disconnected).toBe(true);
    expect(second!.disconnected).toBe(true);
  });

  it('reports when it acted on each hop, before any crossfade or hold', async () => {
    // A recording registers a hop at this moment: it's when playback of the
    // rifff actually began, however long the rifff took to load.
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

    ctx.currentTime = 1;
    const started = await engine.hopTo(JAM, riff('r1'), [stem('a')]);
    ctx.currentTime = 4.1;
    const hopped = await engine.hopTo(JAM, riff('r2'), [stem('b')], { quantise: 'beat' });

    if (started.kind !== 'started') throw new Error('expected a cold start');
    if (hopped.kind !== 'phase-locked') throw new Error('expected a hop');
    expect(started.atSec).toBe(1);
    expect(hopped.atSec).toBe(4.1);
  });

  it('schedules a quantised hop at the held moment, not at the click', async () => {
    // The returned whenSec was right while the audio started at the click:
    // the crossfade ran immediately and the new rifff played ahead of the grid
    // by however long the hold was. Assert what reaches the nodes.
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

    // 0.5s beats. Clicked at 4.1: 4.1 + 0.25 crossfade = 4.35, held to 4.5.
    ctx.currentTime = 0;
    await engine.hopTo(JAM, riff('r1'), [stem('a')]);
    ctx.currentTime = 4.1;
    await engine.hopTo(JAM, riff('r2'), [stem('b')], { quantise: 'beat' });

    // The crossfade runs 4.25 → 4.5, and the new rifff's playhead reaches the
    // grid position 4.5 exactly at 4.5.
    const incoming = ctx.sources[1]!;
    expect(incoming.startedAt?.when).toBeCloseTo(4.25, 6);
    expect(incoming.startedAt?.offset).toBeCloseTo(4.25, 6);

    const [outGain, inGain] = ctx.gains;
    const ramps = (g: MockGain) => g.events.filter((e) => e.kind !== 'cancel');
    expect(ramps(inGain!)).toEqual([
      { kind: 'set', value: 0, time: 4.25 },
      { kind: 'ramp', value: 1, time: 4.5 },
    ]);
    expect(ramps(outGain!)).toEqual([
      { kind: 'set', value: 1, time: 4.25 },
      { kind: 'ramp', value: 0, time: 4.5 },
    ]);
  });

  it('enters immediately when quantisation is off (the default)', async () => {
    const ctx = createMockContext();
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['a' as StemCouchID, fakeBuffer()],
      ['b' as StemCouchID, fakeBuffer()],
    ]);
    const engine = createAudioEngine({
      context: ctx,
      loader: mockLoader(buffers),
      defaultCrossfadeMs: 0,
    });

    ctx.currentTime = 0;
    await engine.hopTo(JAM, riff('r1'), [stem('a')]);
    ctx.currentTime = 4.1;
    const result = await engine.hopTo(JAM, riff('r2'), [stem('b')]);

    if (result.kind !== 'phase-locked') throw new Error('expected a hop');
    expect(result.whenSec).toBeCloseTo(4.1, 6);
  });

  it('reports a quantised hop delay in the log line', async () => {
    const ctx = createMockContext();
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['a' as StemCouchID, fakeBuffer()],
      ['b' as StemCouchID, fakeBuffer()],
    ]);
    const lines: { level: string; message: string }[] = [];
    const engine = createAudioEngine({
      context: ctx,
      loader: mockLoader(buffers),
      defaultCrossfadeMs: 0,
      logger: (level, message) => lines.push({ level, message }),
    });

    ctx.currentTime = 0;
    await engine.hopTo(JAM, riff('r1'), [stem('a')]);
    ctx.currentTime = 4.1;
    await engine.hopTo(JAM, riff('r2'), [stem('b')], { quantise: 'beat' });

    const hopLine = lines.find((l) => l.message.includes('hop r1'));
    expect(hopLine?.message).toContain('quantise=beat');
    expect(hopLine?.message).toContain('+0.40s');
    // An unquantised hop says nothing about it.
    ctx.currentTime = 6;
    await engine.hopTo(JAM, riff('r3'), [stem('a')]);
    expect(lines.find((l) => l.message.includes('hop r2'))?.message).not.toContain('quantise');
  });

  it('starts the incoming sources at the grid position, so the crossfade is in time', async () => {
    // The new voice starts at `now` and reaches the phase anchor when the
    // crossfade completes, which means its playhead equals grid-elapsed at
    // every instant — including throughout the fade, while both are audible.
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

    ctx.currentTime = 5;
    await engine.hopTo(JAM, riff('r1'), [stem('a')]);
    ctx.currentTime = 9;
    await engine.hopTo(JAM, riff('r2'), [stem('b')]);

    const incoming = ctx.sources[1]!;
    expect(incoming.startedAt?.when).toBeCloseTo(9, 6);
    // 4s onto the grid at the moment it starts, not 4.25s.
    expect(incoming.startedAt?.offset).toBeCloseTo(4, 6);
  });

  it('starts a new grid after stopping', async () => {
    const ctx = createMockContext();
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['a' as StemCouchID, fakeBuffer(8)],
      ['b' as StemCouchID, fakeBuffer(8)],
    ]);
    const engine = createAudioEngine({
      context: ctx,
      loader: mockLoader(buffers),
      defaultCrossfadeMs: 0,
    });
    const r = (id: string) => riff(id, { bps: 2, barLength: 8 });

    ctx.currentTime = 10;
    await engine.hopTo(JAM, r('r1'), [stem('a')]);
    ctx.currentTime = 13;
    engine.stop();

    // Playing again starts the grid over, rather than picking up wherever the
    // cursor would have wandered to (LORE does the same on going idle).
    ctx.currentTime = 100;
    await engine.hopTo(JAM, r('r2'), [stem('b')]);
    ctx.currentTime = 101.5;
    const result = await engine.hopTo(JAM, r('r3'), [stem('a')]);
    if (result.kind !== 'phase-locked') throw new Error('expected a hop');
    expect(result.offsetSec).toBeCloseTo(1.5, 6);
  });

  it('phase-locks on the riff grid, and each stem lands in its own repetition', async () => {
    // r1's stem holds only 4s of a 16s (8-bar) riff, so it repeats 4× inside
    // it. Hopping 6s in means 3 bars in, so r2 starts 6s into its own grid —
    // and r2's 4s stem plays from 2s, its position within that bar.
    const ctx = createMockContext();
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['short' as StemCouchID, fakeBuffer(4)],
      ['long' as StemCouchID, fakeBuffer(16)],
      ['short2' as StemCouchID, fakeBuffer(4)],
    ]);
    const engine = createAudioEngine({
      context: ctx,
      loader: mockLoader(buffers),
      defaultCrossfadeMs: 0,
    });

    ctx.currentTime = 0;
    await engine.hopTo(JAM, riff('r1'), [stem('short')]);
    ctx.currentTime = 6;
    const result = await engine.hopTo(JAM, riff('r2'), [stem('long'), stem('short2')]);

    expect(result.kind).toBe('phase-locked');
    if (result.kind === 'phase-locked') {
      expect(result.offsetSec).toBeCloseTo(6, 6);
    }
    const incoming = ctx.sources.slice(1);
    expect(incoming[0]?.startedAt?.offset).toBeCloseTo(6, 6); // 16s stem
    expect(incoming[1]?.startedAt?.offset).toBeCloseTo(2, 6); // 4s stem, 6 mod 4
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

  it('plays a stem borrowed from another tempo at the rifff tempo', async () => {
    // LORE live.riff.cpp: stemTimeScale = riff.BPS / stem.BPS. The riff runs
    // at 2 bps; the stem was cut at 1.6, so it plays 1.25× as fast.
    const ctx = createMockContext();
    const borrowed = { ...stem('slow'), bps: 1.6 };
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['slow' as StemCouchID, fakeBuffer(20)],
    ]);
    const engine = createAudioEngine({ context: ctx, loader: mockLoader(buffers) });

    await engine.hopTo(JAM, riff('r1'), [borrowed]);
    expect(ctx.sources[0]?.playbackRate.value).toBeCloseTo(1.25, 6);
  });

  it('plays a stem at its recorded rate when its tempo matches, or is unusable', async () => {
    const ctx = createMockContext();
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['same' as StemCouchID, fakeBuffer()],
      ['broken' as StemCouchID, fakeBuffer()],
    ]);
    const engine = createAudioEngine({ context: ctx, loader: mockLoader(buffers) });

    // riff('r1') is 2 bps; stem() defaults to the same. A stem document with
    // bps 0 (damaged) must not produce an infinite rate.
    await engine.hopTo(JAM, riff('r1'), [stem('same'), { ...stem('broken'), bps: 0 }]);
    expect(ctx.sources[0]?.playbackRate.value).toBe(1);
    expect(ctx.sources[1]?.playbackRate.value).toBe(1);
  });

  it('warns when a stem decoded length disagrees with its declared length16ths', async () => {
    // length16ths / 4 / bps is what the document says the stem holds. A
    // disagreement means a truncated or corrupt cached file (LORE carries a
    // hackAllowStemSizeMismatch flag for the same class of damage).
    const ctx = createMockContext();
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['truncated' as StemCouchID, fakeBuffer(8)], // declared 16s below
    ]);
    const lines: { level: string; message: string }[] = [];
    const engine = createAudioEngine({
      context: ctx,
      loader: mockLoader(buffers),
      logger: (level, message) => lines.push({ level, message }),
    });

    // bps 2, length16ths 128 → 16s declared, but the buffer holds 8s.
    await engine.hopTo(JAM, riff('r1'), [
      { ...stem('truncated'), bps: 2, length16ths: 128 },
    ]);

    const warning = lines.find((l) => l.message.includes('declared'));
    expect(warning?.level).toBe('warn');
    expect(warning?.message).toContain('truncated');
    expect(warning?.message).toContain('16.00s');
    expect(warning?.message).toContain('8.00s');
  });

  it('reports rate-scaled stems in the log line, and stays quiet when there are none', async () => {
    const ctx = createMockContext();
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['same' as StemCouchID, fakeBuffer()],
      ['slow' as StemCouchID, fakeBuffer(20)],
    ]);
    const lines: { level: string; message: string }[] = [];
    const engine = createAudioEngine({
      context: ctx,
      loader: mockLoader(buffers),
      logger: (level, message) => lines.push({ level, message }),
    });

    await engine.hopTo(JAM, riff('r1'), [stem('same')]);
    expect(lines[0]?.message).not.toContain('scaled');

    // r2 borrows a stem cut at 1.6 bps into a 2 bps rifff → 1.25×.
    ctx.currentTime = 4;
    await engine.hopTo(JAM, riff('r2'), [
      stem('same'),
      { ...stem('slow'), bps: 1.6, length16ths: 64 },
    ]);
    const hopLine = lines.find((l) => l.message.includes('hop r1'));
    expect(hopLine?.message).toContain('scaled=1/2');
    expect(hopLine?.message).toContain('1.250');
  });

  it('reports each hop through the logger: offset, loop, stem count', async () => {
    const ctx = createMockContext();
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['a' as StemCouchID, fakeBuffer()],
      ['b' as StemCouchID, fakeBuffer()],
    ]);
    const lines: { level: string; message: string }[] = [];
    const engine = createAudioEngine({
      context: ctx,
      loader: mockLoader(buffers),
      defaultCrossfadeMs: 250,
      logger: (level, message) => lines.push({ level, message }),
    });

    ctx.currentTime = 0;
    await engine.hopTo(JAM, riff('r1'), [stem('a')]);
    ctx.currentTime = 4;
    await engine.hopTo(JAM, riff('r2'), [stem('b')]);

    expect(lines[0]?.message).toContain('start r1');
    expect(lines[0]?.message).toContain('loop=16.00s');
    expect(lines[0]?.message).toContain('stems=1');
    expect(lines[1]?.message).toContain('hop r1 → r2');
    expect(lines[1]?.message).toContain('offset=4.25s');
    expect(lines[1]?.message).toContain('crossfade=250ms');
  });

  it('stays quiet when stems repeat a whole number of times in the loop', async () => {
    // A 4s stem in a 16s riff is normal — it repeats 4×. Nothing to report.
    const ctx = createMockContext();
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['short' as StemCouchID, fakeBuffer(4)],
      ['full' as StemCouchID, fakeBuffer(16)],
    ]);
    const lines: { level: string; message: string }[] = [];
    const engine = createAudioEngine({
      context: ctx,
      loader: mockLoader(buffers),
      logger: (level, message) => lines.push({ level, message }),
    });

    // length16ths matches each buffer: 32/4/2 = 4s, 128/4/2 = 16s.
    await engine.hopTo(JAM, riff('r1'), [
      { ...stem('short'), length16ths: 32 },
      stem('full'),
    ]);
    expect(lines.filter((l) => l.level === 'warn')).toEqual([]);
  });

  it('warns when a stem does not fit a whole number of times in the loop', async () => {
    // LORE computes repeats = round(riffLength / stemLength); a ragged ratio
    // means the stem cannot line up on every repeat, which is audible.
    const ctx = createMockContext();
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      ['ragged' as StemCouchID, fakeBuffer(6)],
      ['full' as StemCouchID, fakeBuffer(16)],
    ]);
    const lines: { level: string; message: string }[] = [];
    const engine = createAudioEngine({
      context: ctx,
      loader: mockLoader(buffers),
      logger: (level, message) => lines.push({ level, message }),
    });

    // 48/4/2 = 6s, so the declared length agrees with the audio; only the
    // ragged fit against the 16s loop is at issue.
    await engine.hopTo(JAM, riff('r1'), [
      { ...stem('ragged'), length16ths: 48 },
      stem('full'),
    ]);

    const warning = lines.find((l) => l.message.includes("don't fit"));
    expect(warning?.message).toContain('r1');
    expect(warning?.message).toContain('ragged');
    expect(warning?.message).toContain('2.67'); // 16 / 6 repetitions
    // The stem that fits exactly isn't named.
    expect(warning?.message).not.toContain('full');
  });

  it('reports not-ready hops through the logger', async () => {
    const ctx = createMockContext();
    const lines: { level: string; message: string }[] = [];
    const engine = createAudioEngine({
      context: ctx,
      loader: mockLoader(new Map()),
      logger: (level, message) => lines.push({ level, message }),
    });

    await engine.hopTo(JAM, riff('r1'), [stem('s1'), stem('s2')]);

    expect(lines[0]?.level).toBe('warn');
    expect(lines[0]?.message).toContain('not-ready');
    expect(lines[0]?.message).toContain('r1');
  });

  it('warmRiff calls loader.load for each stem', async () => {
    const ctx = createMockContext();
    const loader = mockLoader(new Map());
    const engine = createAudioEngine({ context: ctx, loader });
    await engine.warmRiff(JAM, riff('r1'), [stem('s1'), stem('s2'), stem('s3')]);
    expect(loader.load).toHaveBeenCalledTimes(3);
  });
});
