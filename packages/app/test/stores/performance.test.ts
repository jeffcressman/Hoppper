import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type {
  JamCouchID,
  ResolvedStem,
  RiffCouchID,
  RiffDocument,
  StemCouchID,
} from '@hoppper/sdk';
import {
  definePerformanceStore,
  type StemResolver,
} from '../../src/stores/performance';
import type {
  AudioEngine,
  AudioEngineState,
  HopResult,
} from '../../src/audio/engine';
import type { RiffPrefetcher } from '../../src/audio/prefetch';

const JAM = 'band-1' as JamCouchID;

function riff(id: string): RiffDocument {
  return {
    riffId: id as RiffCouchID,
    jamId: JAM,
    userName: 'u',
    createdAt: 0,
    bps: 2,
    bpm: 120,
    barLength: 16,
    root: 0,
    scale: 0,
    slots: [],
  };
}

function mockEngine(): AudioEngine & {
  _emit: (s: AudioEngineState) => void;
} {
  const listeners = new Set<(s: AudioEngineState) => void>();
  let state: AudioEngineState = 'idle';
  let currentRiffId: RiffCouchID | null = null;

  const eng = {
    get state() {
      return state;
    },
    get currentRiffId() {
      return currentRiffId;
    },
    now: vi.fn(() => 0),
    warmRiff: vi.fn(async () => {}),
    hopTo: vi.fn(async (_jam, r: RiffDocument): Promise<HopResult> => {
      state = 'playing';
      currentRiffId = r.riffId;
      for (const l of listeners) l(state);
      return { kind: 'started', riffId: r.riffId, whenSec: 0 };
    }),
    stop: vi.fn(() => {
      state = 'idle';
      currentRiffId = null;
      for (const l of listeners) l(state);
    }),
    onStateChange(fn: (s: AudioEngineState) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    _emit(s: AudioEngineState) {
      state = s;
      for (const l of listeners) l(s);
    },
  };
  return eng as AudioEngine & { _emit: (s: AudioEngineState) => void };
}

function mockPrefetcher(): RiffPrefetcher {
  return { setWindow: vi.fn(), cancel: vi.fn() };
}

function fakeStem(id: string): ResolvedStem {
  return {
    stemId: id as StemCouchID,
    format: 'ogg',
    url: '',
    length: 0,
    mime: 'audio/ogg',
  };
}

beforeEach(() => setActivePinia(createPinia()));

describe('definePerformanceStore', () => {
  it('mirrors engine state via onStateChange', () => {
    const engine = mockEngine();
    const useStore = definePerformanceStore({
      engine,
      prefetcher: mockPrefetcher(),
      resolveStems: vi.fn(),
    });
    const store = useStore();
    expect(store.state).toBe('idle');

    engine._emit('playing');
    expect(store.state).toBe('playing');
  });

  it('hopTo resolves stems, warms, then hops; on success exposes currentRiffId', async () => {
    const engine = mockEngine();
    const resolveStems: StemResolver = vi.fn(async () => [fakeStem('s1')]);
    const useStore = definePerformanceStore({
      engine,
      prefetcher: mockPrefetcher(),
      resolveStems,
    });
    const store = useStore();
    const r = riff('r1');
    const result = await store.hopTo(JAM, r);
    expect(result.kind).toBe('started');
    expect(resolveStems).toHaveBeenCalledWith(JAM, r);
    expect(engine.warmRiff).toHaveBeenCalledWith(JAM, r, [fakeStem('s1')]);
    expect(engine.hopTo).toHaveBeenCalledWith(JAM, r, [fakeStem('s1')]);
    expect(store.currentRiffId).toBe('r1');
  });

  it('hopTo with not-ready surfaces missing stem IDs', async () => {
    const engine = mockEngine();
    engine.hopTo = vi.fn(
      async (): Promise<HopResult> => ({
        kind: 'not-ready',
        missingStemIds: ['x' as StemCouchID, 'y' as StemCouchID],
      }),
    );
    const useStore = definePerformanceStore({
      engine,
      prefetcher: mockPrefetcher(),
      resolveStems: vi.fn(async () => [fakeStem('x'), fakeStem('y')]),
    });
    const store = useStore();
    const result = await store.hopTo(JAM, riff('r1'));
    expect(result.kind).toBe('not-ready');
    expect(store.missingStems).toEqual(['x', 'y']);
  });

  it('hopTo records lastError when stem resolution throws', async () => {
    const engine = mockEngine();
    const useStore = definePerformanceStore({
      engine,
      prefetcher: mockPrefetcher(),
      resolveStems: vi.fn(async () => {
        throw new Error('no network');
      }),
    });
    const store = useStore();
    const result = await store.hopTo(JAM, riff('r1'));
    expect(result.kind).toBe('not-ready');
    expect(store.lastError).toBe('no network');
    expect(engine.warmRiff).not.toHaveBeenCalled();
  });

  it('stop delegates to engine.stop', () => {
    const engine = mockEngine();
    const useStore = definePerformanceStore({
      engine,
      prefetcher: mockPrefetcher(),
      resolveStems: vi.fn(),
    });
    const store = useStore();
    store.stop();
    expect(engine.stop).toHaveBeenCalled();
  });

  it('prefetchWindow slices riffs around center and calls setWindow', async () => {
    const engine = mockEngine();
    const prefetcher = mockPrefetcher();
    const resolveStems: StemResolver = vi.fn(async () => [fakeStem('s')]);
    const useStore = definePerformanceStore({
      engine,
      prefetcher,
      resolveStems,
    });
    const store = useStore();

    const riffs = ['r0', 'r1', 'r2', 'r3', 'r4'].map(riff);
    await store.prefetchWindow(JAM, riffs, 2, 2);
    expect(resolveStems).toHaveBeenCalledTimes(5); // all 5 in window
    expect(prefetcher.setWindow).toHaveBeenCalledTimes(1);
  });

  it('prefetchWindow clamps the window at jam boundaries', async () => {
    const engine = mockEngine();
    const prefetcher = mockPrefetcher();
    const resolveStems: StemResolver = vi.fn(async () => []);
    const useStore = definePerformanceStore({
      engine,
      prefetcher,
      resolveStems,
    });
    const store = useStore();

    const riffs = ['r0', 'r1', 'r2'].map(riff);
    await store.prefetchWindow(JAM, riffs, 0, 2);
    // window = [0, min(3, 0+2+1)) = [0,3) → all 3
    expect(resolveStems).toHaveBeenCalledTimes(3);
  });
});
