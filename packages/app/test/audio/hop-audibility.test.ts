// End-to-end audibility checks for hopping.
//
// The other audio tests assert the calls the engine makes; these model what a
// listener would actually hear. A mock context tracks, per source: whether it
// started, whether its scheduled stop has passed, whether it is still
// connected to the destination, and its voice's gain automation. From that we
// can ask "which stems are making sound at time t" and assert the two things
// that matter for a hop: the outgoing rifff is still audible for the whole
// crossfade, and once the crossfade is over exactly one rifff is left.
//
// Regression origin: hops were disconnecting the outgoing voice on the next
// microtask, so the crossfade never happened and every hop was a hard cut.
import { describe, it, expect } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type {
  JamCouchID,
  ResolvedStem,
  RiffCouchID,
  RiffDocument,
  StemCouchID,
} from '@hoppper/sdk';
import { createAudioEngine } from '../../src/audio/engine.js';
import { createPrefetchRing } from '../../src/audio/prefetch.js';
import { definePerformanceStore } from '../../src/stores/performance.js';
import type {
  AudioContextLike,
  AudioBufferSourceLike,
  AudioNodeLike,
  GainNodeLike,
} from '../../src/audio/riff-voice.js';
import type { AudioBufferLike } from '../../src/audio/audio-buffer-cache.js';
import type { StemLoader } from '../../src/audio/stem-loader.js';

const JAM = 'band-test' as JamCouchID;
const CROSSFADE_SEC = 0.25;

function riff(id: string, bps = 2): RiffDocument {
  return {
    riffId: id as RiffCouchID,
    jamId: JAM,
    userName: 'u',
    createdAt: 0,
    bps,
    bpm: bps * 60,
    barLength: 16,
    root: 0,
    scale: 0,
    slots: [],
  };
}

function buf(duration = 16): AudioBufferLike {
  return {
    length: Math.round(duration * 48000),
    numberOfChannels: 2,
    sampleRate: 48000,
    duration,
  };
}

interface GainEvent {
  kind: 'set' | 'ramp' | 'cancel';
  value?: number;
  time: number;
}

interface SpySource extends AudioBufferSourceLike {
  /** The voice this source plays in (1, 2, … in start order). */
  voiceId: number;
  startWhen?: number;
  startOffset?: number;
  stopWhen?: number;
  target: AudioNodeLike | null;
}

interface SpyGain extends GainNodeLike {
  id: number;
  initial: number;
  events: GainEvent[];
  target: AudioNodeLike | null;
}

/** Gain value at time t, honouring cancels and interpolating linear ramps. */
function gainAt(events: GainEvent[], t: number, initial = 1): number {
  const timeline: GainEvent[] = [];
  for (const ev of events) {
    if (ev.kind === 'cancel') {
      // cancelScheduledValues drops everything scheduled at or after `time`.
      for (let i = timeline.length - 1; i >= 0; i--) {
        if (timeline[i]!.time >= ev.time) timeline.splice(i, 1);
      }
      continue;
    }
    timeline.push(ev);
  }
  timeline.sort((a, b) => a.time - b.time);

  let value = initial;
  let lastTime = -Infinity;
  for (const ev of timeline) {
    if (ev.time <= t) {
      value = ev.value ?? value;
      lastTime = ev.time;
      continue;
    }
    if (ev.kind === 'ramp' && t > lastTime) {
      const span = ev.time - lastTime;
      if (span <= 0) return value;
      return value + ((ev.value ?? value) - value) * ((t - lastTime) / span);
    }
    break;
  }
  return value;
}

interface SpyCtx extends AudioContextLike {
  currentTime: number;
  sources: SpySource[];
  gains: SpyGain[];
  /** Sources making sound at time t. */
  audibleAt(t: number): SpySource[];
  /** Distinct voices making sound at time t. */
  audibleVoicesAt(t: number): number[];
  /** Fire onended for every source whose scheduled stop has passed by t. */
  flushEndedThrough(t: number): void;
}

function createSpyContext(): SpyCtx {
  const sources: SpySource[] = [];
  const gains: SpyGain[] = [];
  const destination: AudioNodeLike = {};
  let gainCounter = 0;
  const voiceOrder: SpyGain[] = [];

  // A source plays through its stem gain, then its voice's gain, then on to
  // the destination. The voice is identified by that voice gain.
  function voiceGainOf(src: SpySource): SpyGain | null {
    const stemGain = gains.find((g) => g === src.target);
    return gains.find((g) => g === stemGain?.target) ?? null;
  }

  /** The gain a source is heard at: every gain on its path, multiplied. Zero if it doesn't reach the destination. */
  function levelAt(src: SpySource, t: number): number {
    let node: AudioNodeLike | null = src.target;
    let level = 1;
    for (let hops = 0; node !== null && hops < 8; hops++) {
      if (node === destination) return level;
      const g = gains.find((cand) => cand === node);
      if (!g) return 0;
      level *= gainAt(g.events, t, g.initial);
      node = g.target;
    }
    return 0;
  }

  const ctx: SpyCtx = {
    currentTime: 0,
    destination,
    sources,
    gains,
    createBufferSource() {
      const src: SpySource = {
        // Voices are numbered 1, 2, … in the order they start, fixed at start
        // so a voice keeps its number after it has been torn down.
        voiceId: 0,
        buffer: null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        playbackRate: {
          value: 1,
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          cancelScheduledValues() {},
        },
        onended: null,
        target: null,
        start(when = 0, offset = 0) {
          src.startWhen = when;
          src.startOffset = offset;
          const own = voiceGainOf(src);
          if (own && !voiceOrder.includes(own)) voiceOrder.push(own);
          src.voiceId = own ? voiceOrder.indexOf(own) + 1 : 0;
        },
        stop(when = 0) {
          src.stopWhen = when;
        },
        connect(dest) {
          src.target = dest;
        },
        disconnect() {
          src.target = null;
        },
      };
      sources.push(src);
      return src;
    },
    createGain() {
      gainCounter += 1;
      const events: GainEvent[] = [];
      const g: SpyGain & { initial: number } = {
        id: gainCounter,
        events,
        initial: 1,
        target: null,
        gain: {
          get value() {
            return gainAt(events, ctx.currentTime, g.initial);
          },
          // Assigning .value sets the level before any automation.
          set value(v: number) {
            g.initial = v;
          },
          setValueAtTime(v, t) {
            events.push({ kind: 'set', value: v, time: t });
          },
          linearRampToValueAtTime(v, t) {
            events.push({ kind: 'ramp', value: v, time: t });
          },
          cancelScheduledValues(t) {
            events.push({ kind: 'cancel', time: t });
          },
        },
        connect(dest) {
          g.target = dest;
        },
        disconnect() {
          g.target = null;
        },
      };
      gains.push(g);
      return g;
    },
    audibleAt(t) {
      return sources.filter((src) => {
        if (src.startWhen === undefined || src.startWhen > t) return false;
        if (src.stopWhen !== undefined && src.stopWhen <= t) return false;
        return levelAt(src, t) > 0.001;
      });
    },
    audibleVoicesAt(t) {
      return [...new Set(ctx.audibleAt(t).map((s) => s.voiceId))];
    },
    flushEndedThrough(t) {
      for (const src of sources) {
        if (src.stopWhen !== undefined && src.stopWhen <= t && src.onended) {
          const fire = src.onended;
          src.onended = null;
          fire({});
        }
      }
    },
  };
  return ctx;
}

function loaderFor(buffers: Map<StemCouchID, AudioBufferLike>): StemLoader {
  return {
    peek: (id) => buffers.get(id),
    load: async (s) => {
      let b = buffers.get(s.stemId);
      if (!b) {
        b = buf();
        buffers.set(s.stemId, b);
      }
      return b;
    },
  };
}

function stemsFor(riffId: string, count = 2): ResolvedStem[] {
  return Array.from({ length: count }, (_unused, n) => ({
    stemId: `${riffId}-s${n}` as StemCouchID,
    format: 'ogg' as const,
    url: `https://cdn.example/${riffId}-${n}.ogg`,
    byteLength: 4,
    mime: 'audio/ogg',
    bps: 2,
    length16ths: 128,
  }));
}

describe('hop audibility', () => {
  it('keeps the outgoing rifff audible across the crossfade, then leaves one', async () => {
    const ctx = createSpyContext();
    const buffers = new Map<StemCouchID, AudioBufferLike>();
    for (const s of [...stemsFor('r1'), ...stemsFor('r2')]) buffers.set(s.stemId, buf());
    const engine = createAudioEngine({
      context: ctx,
      loader: loaderFor(buffers),
      defaultCrossfadeMs: CROSSFADE_SEC * 1000,
    });

    ctx.currentTime = 1;
    await engine.hopTo(JAM, riff('r1'), stemsFor('r1'));
    expect(ctx.audibleVoicesAt(1).length).toBe(1);

    ctx.currentTime = 3;
    await engine.hopTo(JAM, riff('r2'), stemsFor('r2'));
    await Promise.resolve();

    // Mid-crossfade both rifffs sound — that is what makes a hop seamless.
    expect(ctx.audibleVoicesAt(3.1).length).toBe(2);
    // Once the fade has landed, the outgoing rifff is gone.
    ctx.currentTime = 3.5;
    ctx.flushEndedThrough(3.5);
    expect(ctx.audibleVoicesAt(3.5).length).toBe(1);
    // …and its nodes have been released.
    expect(ctx.audibleAt(3.5).every((s) => s.voiceId === 2)).toBe(true);
  });

  it('lands every stem at the same point in the loop, whatever its length', async () => {
    // Stems of a rifff can be shorter than the rifff's computed loop. Each one
    // must land at its own position in the same grid; otherwise the stems of
    // one rifff drift apart and it sounds like two rifffs at once.
    const ctx = createSpyContext();
    const stems = stemsFor('r2', 3);
    const buffers = new Map<StemCouchID, AudioBufferLike>([
      [stems[0]!.stemId, buf(16)],
      [stems[1]!.stemId, buf(8)],
      [stems[2]!.stemId, buf(4)],
    ]);
    for (const s of stemsFor('r1')) buffers.set(s.stemId, buf(16));
    const engine = createAudioEngine({
      context: ctx,
      loader: loaderFor(buffers),
      defaultCrossfadeMs: 0,
    });

    ctx.currentTime = 0;
    await engine.hopTo(JAM, riff('r1'), stemsFor('r1'));
    ctx.currentTime = 9.2;
    await engine.hopTo(JAM, riff('r2'), stems);

    const incoming = ctx.sources.filter((s) => s.voiceId === 2);
    expect(incoming).toHaveLength(3);
    expect(incoming[0]!.startOffset).toBeCloseTo(9.2, 6);
    expect(incoming[1]!.startOffset).toBeCloseTo(1.2, 6); // 9.2 mod 8
    expect(incoming[2]!.startOffset).toBeCloseTo(1.2, 6); // 9.2 mod 4
    // Every stem sits at the same point in the bar it belongs to.
    for (const src of incoming) {
      expect((9.2 - src.startOffset!) % 4).toBeCloseTo(0, 6);
    }
  });

  it('leaves one rifff audible for every order clicks can resolve in', async () => {
    // Clicks are async (stem resolve + warm), so two Hop presses can land in
    // either order and can interleave. Whatever happens, the engine must not
    // leave two rifffs running once everything settles.
    const orderings: number[][] = [
      [0, 1],
      [1, 0],
      [0, 1, 2],
      [2, 0, 1],
      [1, 2, 0],
      [2, 1, 0],
    ];

    for (const order of orderings) {
      setActivePinia(createPinia());
      const ctx = createSpyContext();
      const riffs = [riff('r1'), riff('r2', 2.5), riff('r3', 1.75)];
      const buffers = new Map<StemCouchID, AudioBufferLike>();
      for (const r of riffs) {
        for (const s of stemsFor(r.riffId)) buffers.set(s.stemId, buf());
      }
      const loader = loaderFor(buffers);
      const engine = createAudioEngine({
        context: ctx,
        loader,
        defaultCrossfadeMs: CROSSFADE_SEC * 1000,
      });
      // Release each riff's stem resolution in a controlled order.
      const gates = new Map<string, () => void>();
      const useStore = definePerformanceStore({
        engine,
        prefetcher: createPrefetchRing({ loader }),
        resolveStems: async (_jamId, r) => {
          await new Promise<void>((resolve) => gates.set(r.riffId, resolve));
          return stemsFor(r.riffId);
        },
      });
      const store = useStore();

      const clicks = order.map((i) => {
        ctx.currentTime += 1;
        return store.hopTo(JAM, riffs[i]!);
      });
      // Wait for every click to be parked on its gate, then release them in
      // the order this case dictates.
      while (gates.size < order.length) await Promise.resolve();
      for (const i of order) gates.get(riffs[i]!.riffId)!();
      await Promise.all(clicks);

      const settleAt = ctx.currentTime + CROSSFADE_SEC + 1;
      ctx.currentTime = settleAt;
      ctx.flushEndedThrough(settleAt);
      expect(
        ctx.audibleVoicesAt(settleAt),
        `ordering ${order.join(',')} left more than one rifff playing`,
      ).toHaveLength(1);
    }
  });
});
