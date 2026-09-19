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
import type { HopRecorder } from '../../src/hop-recorder/recorder';

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

type MockEngine = AudioEngine & {
  _emit: (s: AudioEngineState) => void;
  /** Another caller (the replay player) moved the engine to this rifff. */
  _emitRiff: (riffId: RiffCouchID | null) => void;
};

function mockEngine(): MockEngine {
  const listeners = new Set<(s: AudioEngineState) => void>();
  const riffListeners = new Set<(id: RiffCouchID | null) => void>();
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
      return { kind: 'started', riffId: r.riffId, whenSec: 0, atSec: 0 };
    }),
    stop: vi.fn(() => {
      state = 'idle';
      currentRiffId = null;
      for (const l of listeners) l(state);
    }),
    slotLevels: [1, 1, 1, 1, 1, 1, 1, 1],
    setSlotLevels: vi.fn(),
    playhead: vi.fn(() => null),
    levels: vi.fn((): [number, number] => [0, 0]),
    trackMeters: vi.fn(() => [0, 0, 0, 0, 0, 0, 0, 0]),
    onStateChange(fn: (s: AudioEngineState) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onRiffChange(fn: (id: RiffCouchID | null) => void) {
      riffListeners.add(fn);
      return () => riffListeners.delete(fn);
    },
    _emit(s: AudioEngineState) {
      state = s;
      for (const l of listeners) l(s);
    },
    _emitRiff(id: RiffCouchID | null) {
      currentRiffId = id;
      for (const l of riffListeners) l(id);
    },
  };
  return eng as MockEngine;
}

function mockPrefetcher(): RiffPrefetcher {
  return { setWindow: vi.fn(), cancel: vi.fn() };
}

function fakeStem(id: string): ResolvedStem {
  return {
    stemId: id as StemCouchID,
    format: 'ogg',
    url: '',
    byteLength: 0,
    mime: 'audio/ogg',
  bps: 2,
    length16ths: 128,
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

  it('follows the engine to each rifff, including hops made by replay', () => {
    // Replay drives the engine directly, never through store.hopTo, and the
    // engine stays 'playing' across those hops — so the current rifff has to
    // come from the engine's per-rifff signal.
    const engine = mockEngine();
    const useStore = definePerformanceStore({
      engine,
      prefetcher: mockPrefetcher(),
      resolveStems: vi.fn(),
    });
    const store = useStore();

    engine._emitRiff('r1' as RiffCouchID);
    engine._emit('playing');
    expect(store.currentRiffId).toBe('r1');
    engine._emitRiff('r2' as RiffCouchID);
    expect(store.currentRiffId).toBe('r2');
    engine._emitRiff(null);
    expect(store.currentRiffId).toBeNull();
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

  describe('quantised entry', () => {
    it('is off by default, and hops carry no quantise option', async () => {
      const engine = mockEngine();
      const useStore = definePerformanceStore({
        engine,
        prefetcher: mockPrefetcher(),
        resolveStems: vi.fn(async () => [fakeStem('s1')]),
      });
      const store = useStore();
      expect(store.quantiseEntry).toBe(false);

      const r = riff('r1');
      await store.hopTo(JAM, r);
      expect(engine.hopTo).toHaveBeenCalledWith(JAM, r, [fakeStem('s1')]);
    });

    it('passes quantise=beat to the engine once switched on', async () => {
      const engine = mockEngine();
      const useStore = definePerformanceStore({
        engine,
        prefetcher: mockPrefetcher(),
        resolveStems: vi.fn(async () => [fakeStem('s1')]),
      });
      const store = useStore();
      store.quantiseEntry = true;

      const r = riff('r1');
      await store.hopTo(JAM, r);
      expect(engine.hopTo).toHaveBeenCalledWith(JAM, r, [fakeStem('s1')], {
        quantise: 'beat',
      });
    });

    it('honours a non-default quantisation grid', async () => {
      const engine = mockEngine();
      const useStore = definePerformanceStore({
        engine,
        prefetcher: mockPrefetcher(),
        resolveStems: vi.fn(async () => [fakeStem('s1')]),
        quantiseGrid: 'bar',
      });
      const store = useStore();
      store.quantiseEntry = true;

      await store.hopTo(JAM, riff('r1'));
      expect(engine.hopTo).toHaveBeenCalledWith(JAM, riff('r1'), [fakeStem('s1')], {
        quantise: 'bar',
      });
    });
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

  it('stop() cancels a hop whose rifff is still loading', async () => {
    // Otherwise the rifff starts playing when it finishes loading, after the
    // user pressed Stop (or Record, which stops first).
    const engine = mockEngine();
    let finishLoading!: () => void;
    vi.mocked(engine.warmRiff).mockImplementation(
      () => new Promise<void>((resolve) => (finishLoading = resolve)),
    );
    const recorder = {
      isRecording: true,
      state: 'armed' as const,
      start: vi.fn(),
      recordHop: vi.fn(),
      stop: vi.fn(),
      onStateChange: () => () => {},
    } as unknown as HopRecorder;
    const useStore = definePerformanceStore({
      engine,
      prefetcher: mockPrefetcher(),
      resolveStems: vi.fn(async () => [fakeStem('s')]),
      recorder,
    });
    const store = useStore();

    const hop = store.hopTo(JAM, riff('r1'));
    await vi.waitFor(() => expect(engine.warmRiff).toHaveBeenCalled());
    store.stop();
    finishLoading();

    expect(await hop).toEqual({ kind: 'cancelled' });
    expect(engine.hopTo).not.toHaveBeenCalled();
    expect(recorder.recordHop).not.toHaveBeenCalled();
  });

  it('a newer click cancels an older one whose rifff has not started playing', async () => {
    // Decided 2026-09-17: the latest click wins. Otherwise whichever rifff
    // finished loading last would play, even if it was clicked first.
    const engine = mockEngine();
    const loads = new Map<string, () => void>();
    vi.mocked(engine.warmRiff).mockImplementation(
      (_jam, r: RiffDocument) =>
        new Promise<void>((resolve) => loads.set(r.riffId, resolve)),
    );
    const recorder = {
      isRecording: true,
      state: 'recording' as const,
      start: vi.fn(),
      recordHop: vi.fn(),
      stop: vi.fn(),
      onStateChange: () => () => {},
    } as unknown as HopRecorder;
    const useStore = definePerformanceStore({
      engine,
      prefetcher: mockPrefetcher(),
      resolveStems: vi.fn(async () => [fakeStem('s')]),
      recorder,
    });
    const store = useStore();

    const first = store.hopTo(JAM, riff('r1'));
    await vi.waitFor(() => expect(loads.has('r1')).toBe(true));
    const second = store.hopTo(JAM, riff('r2'));
    await vi.waitFor(() => expect(loads.has('r2')).toBe(true));

    // The first click's rifff finishes loading first, and still doesn't play.
    loads.get('r1')!();
    expect(await first).toEqual({ kind: 'cancelled' });
    loads.get('r2')!();
    expect((await second).kind).toBe('started');

    expect(vi.mocked(engine.hopTo).mock.calls.map((c) => c[1].riffId)).toEqual(['r2']);
    expect(vi.mocked(recorder.recordHop).mock.calls.map((c) => c[0].riffId)).toEqual(['r2']);
  });

  it('an overtaken click that then fails to resolve reports nothing', async () => {
    const engine = mockEngine();
    let failFirst!: (err: Error) => void;
    const resolveStems: StemResolver = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<ResolvedStem[]>((_ok, fail) => (failFirst = fail)),
      )
      .mockImplementation(async () => [fakeStem('s')]);
    const useStore = definePerformanceStore({
      engine,
      prefetcher: mockPrefetcher(),
      resolveStems,
    });
    const store = useStore();

    const first = store.hopTo(JAM, riff('r1'));
    await store.hopTo(JAM, riff('r2'));
    failFirst(new Error('offline'));

    expect(await first).toEqual({ kind: 'cancelled' });
    expect(store.lastError).toBeNull();
  });

  it('a click after a rifff has started playing hops from it as usual', async () => {
    const engine = mockEngine();
    const useStore = definePerformanceStore({
      engine,
      prefetcher: mockPrefetcher(),
      resolveStems: vi.fn(async () => [fakeStem('s')]),
    });
    const store = useStore();
    expect((await store.hopTo(JAM, riff('r1'))).kind).toBe('started');
    await store.hopTo(JAM, riff('r2'));
    expect(vi.mocked(engine.hopTo).mock.calls.map((c) => c[1].riffId)).toEqual(['r1', 'r2']);
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

  describe('recorder integration', () => {
    function mockRecorder(isRecording: boolean): HopRecorder {
      let recording = isRecording;
      return {
        get state() {
          return recording ? ('recording' as const) : ('idle' as const);
        },
        get isRecording() {
          return recording;
        },
        onStateChange: () => () => {},
        start: vi.fn(() => {
          recording = true;
        }),
        recordHop: vi.fn(),
        stop: vi.fn(() => {
          recording = false;
          return {
            schemaVersion: 1 as const,
            id: 'seq',
            title: 't',
            jamId: JAM,
            recordedAt: '',
            durationSec: 0,
            hops: [],
          };
        }),
      };
    }

    it('records the hop when its rifff starts playing, at the engine\'s time', async () => {
      // Not at the click: a rifff that has to load first starts later, and
      // the take has to line up with what was heard.
      const engine = mockEngine();
      engine.hopTo = vi.fn(
        async (_j, r: RiffDocument): Promise<HopResult> => ({
          kind: 'phase-locked',
          riffId: r.riffId,
          whenSec: 7.5,
          offsetSec: 0,
          atSec: 7.25,
        }),
      );
      const recorder = mockRecorder(true);
      const useStore = definePerformanceStore({
        engine,
        prefetcher: mockPrefetcher(),
        resolveStems: vi.fn(async () => [fakeStem('s')]),
        recorder,
        defaultCrossfadeMs: 250,
      });
      const store = useStore();
      await store.hopTo(JAM, riff('r1'));
      expect(recorder.recordHop).toHaveBeenCalledWith(
        { riffId: 'r1', jamId: JAM, transitionMs: 250 },
        7.25,
      );
      expect(vi.mocked(engine.warmRiff).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(recorder.recordHop).mock.invocationCallOrder[0]!,
      );
    });

    it('records the quantise grid with the hop when quantised entry is on', async () => {
      const engine = mockEngine();
      const recorder = mockRecorder(true);
      const useStore = definePerformanceStore({
        engine,
        prefetcher: mockPrefetcher(),
        resolveStems: vi.fn(async () => [fakeStem('s')]),
        recorder,
        defaultCrossfadeMs: 250,
      });
      const store = useStore();
      store.quantiseEntry = true;
      await store.hopTo(JAM, riff('r1'));
      expect(recorder.recordHop).toHaveBeenCalledWith(
        { riffId: 'r1', jamId: JAM, transitionMs: 250, quantise: 'beat' },
        0,
      );
    });

    it('does NOT call recorder.recordHop when not recording', async () => {
      const engine = mockEngine();
      const recorder = mockRecorder(false);
      const useStore = definePerformanceStore({
        engine,
        prefetcher: mockPrefetcher(),
        resolveStems: vi.fn(async () => [fakeStem('s')]),
        recorder,
      });
      const store = useStore();
      await store.hopTo(JAM, riff('r1'));
      expect(recorder.recordHop).not.toHaveBeenCalled();
    });

    it('does not record a click whose rifff never played: not-ready', async () => {
      // A take holds what was heard. Replaying a hop that never sounded
      // would play something the performer never heard.
      const engine = mockEngine();
      engine.hopTo = vi.fn(
        async (): Promise<HopResult> => ({
          kind: 'not-ready',
          missingStemIds: ['s' as StemCouchID],
        }),
      );
      const recorder = mockRecorder(true);
      const useStore = definePerformanceStore({
        engine,
        prefetcher: mockPrefetcher(),
        resolveStems: vi.fn(async () => [fakeStem('s')]),
        recorder,
      });
      const store = useStore();
      await store.hopTo(JAM, riff('r1'));
      expect(recorder.recordHop).not.toHaveBeenCalled();
    });

    it('does not record a click whose stems could not be resolved', async () => {
      const engine = mockEngine();
      const recorder = mockRecorder(true);
      const useStore = definePerformanceStore({
        engine,
        prefetcher: mockPrefetcher(),
        resolveStems: vi.fn(async () => {
          throw new Error('offline');
        }),
        recorder,
      });
      const store = useStore();
      await store.hopTo(JAM, riff('r1'));
      expect(recorder.recordHop).not.toHaveBeenCalled();
    });

    it('works without a recorder injected (recorder is optional)', async () => {
      const engine = mockEngine();
      const useStore = definePerformanceStore({
        engine,
        prefetcher: mockPrefetcher(),
        resolveStems: vi.fn(async () => [fakeStem('s')]),
      });
      const store = useStore();
      await expect(store.hopTo(JAM, riff('r1'))).resolves.toBeDefined();
    });
  });
});

describe('definePerformanceStore — mixer', () => {
  const store = () => {
    const engine = mockEngine();
    const s = definePerformanceStore({ engine, prefetcher: mockPrefetcher(), resolveStems: vi.fn() })();
    return { engine, s };
  };

  it('starts every slot at full level, unmuted — each rifff as it was committed', () => {
    const { s } = store();
    expect(s.slotLevels).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(s.slotMuted).toEqual([false, false, false, false, false, false, false, false]);
  });

  it('a fader move sets that slot’s level in the engine', () => {
    const { engine, s } = store();
    s.setSlotLevel(2, 0.4);
    expect(s.slotLevels[2]).toBe(0.4);
    expect(engine.setSlotLevels).toHaveBeenLastCalledWith([1, 1, 0.4, 1, 1, 1, 1, 1]);
  });

  it('keeps a level between 0 and 1', () => {
    const { s } = store();
    s.setSlotLevel(0, 1.7);
    s.setSlotLevel(1, -0.2);
    expect(s.slotLevels.slice(0, 2)).toEqual([1, 0]);
  });

  it('mute silences a slot in the engine without losing its fader level', () => {
    const { engine, s } = store();
    s.setSlotLevel(3, 0.6);
    s.toggleMute(3);
    expect(s.slotMuted[3]).toBe(true);
    expect(engine.setSlotLevels).toHaveBeenLastCalledWith([1, 1, 1, 0, 1, 1, 1, 1]);
    s.toggleMute(3);
    expect(engine.setSlotLevels).toHaveBeenLastCalledWith([1, 1, 1, 0.6, 1, 1, 1, 1]);
  });
});

describe('definePerformanceStore — play again', () => {
  it('remembers the last rifff played, so Play can start it again after a stop', async () => {
    const engine = mockEngine();
    const resolveStems = vi.fn(async () => [fakeStem('s1')]);
    const s = definePerformanceStore({ engine, prefetcher: mockPrefetcher(), resolveStems })();
    expect(s.canResume).toBe(false);
    await s.hopTo(JAM, riff('r1'));
    s.stop();
    expect(s.canResume).toBe(true);
    await s.resume();
    expect(engine.hopTo).toHaveBeenLastCalledWith(JAM, riff('r1'), [fakeStem('s1')]);
  });
});

describe('definePerformanceStore — what the page draws from', () => {
  it('passes on where the engine’s playhead is and how loud it is', () => {
    const engine = mockEngine();
    const head = { riffId: 'r1' as RiffCouchID, positionSec: 3, loopSec: 16 };
    vi.mocked(engine.playhead).mockReturnValue(head);
    vi.mocked(engine.levels).mockReturnValue([0.5, 0.4]);
    vi.mocked(engine.trackMeters).mockReturnValue([0, 0.3, 0, 0, 0, 0, 0, 0]);
    const s = definePerformanceStore({ engine, prefetcher: mockPrefetcher(), resolveStems: vi.fn() })();
    expect(s.playhead()).toEqual(head);
    expect(s.levels()).toEqual([0.5, 0.4]);
    expect(s.trackMeters()).toEqual([0, 0.3, 0, 0, 0, 0, 0, 0]);
  });

  it('hands out a stem’s decoded audio when it has been loaded, for the waveform', () => {
    const buffer = { length: 1, numberOfChannels: 1, sampleRate: 1, duration: 1 };
    const s = definePerformanceStore({
      engine: mockEngine(),
      prefetcher: mockPrefetcher(),
      resolveStems: vi.fn(),
      peekBuffer: (id) => (id === 's1' ? buffer : undefined),
    })();
    expect(s.bufferFor('s1' as StemCouchID)).toBe(buffer);
    expect(s.bufferFor('s2' as StemCouchID)).toBeUndefined();
  });
});

describe('definePerformanceStore — decoded audio', () => {
  it('ticks whenever a rifff starts playing, since its stems are decoded by then — so shapes drawn from audio can refresh', () => {
    const engine = mockEngine();
    const s = definePerformanceStore({ engine, prefetcher: mockPrefetcher(), resolveStems: vi.fn() })();
    const before = s.decodedTick;
    engine._emitRiff('r1' as RiffCouchID);
    expect(s.decodedTick).toBe(before + 1);
    engine._emitRiff(null);
    expect(s.decodedTick).toBe(before + 1);
  });
});

describe('definePerformanceStore — loading without playing', () => {
  it('warm(jamId, riff) loads a rifff’s stems for drawing, and ticks when they are in', async () => {
    const engine = mockEngine();
    const resolveStems = vi.fn(async () => [fakeStem('s1')]);
    const s = definePerformanceStore({ engine, prefetcher: mockPrefetcher(), resolveStems })();
    const before = s.decodedTick;
    await s.warm(JAM, riff('r1'));
    expect(engine.warmRiff).toHaveBeenCalledWith(JAM, riff('r1'), [fakeStem('s1')]);
    expect(engine.hopTo).not.toHaveBeenCalled();
    expect(s.decodedTick).toBe(before + 1);
  });
});

describe('definePerformanceStore — each page has its own mix', () => {
  const unity = [1, 1, 1, 1, 1, 1, 1, 1];
  const store = () => {
    const engine = mockEngine();
    const s = definePerformanceStore({ engine, prefetcher: mockPrefetcher(), resolveStems: vi.fn() })();
    return { engine, s };
  };

  it('the editor plays at the rifffs’ own mix, whatever the recording page muted', () => {
    const { engine, s } = store();
    s.toggleMute(2);
    s.useMix('editor');
    expect(engine.setSlotLevels).toHaveBeenLastCalledWith(unity);
  });

  it('coming back to the recording page puts its mix back', () => {
    const { engine, s } = store();
    s.setSlotLevel(0, 0.5);
    s.toggleMute(2);
    s.useMix('editor');
    s.useMix('recording');
    expect(engine.setSlotLevels).toHaveBeenLastCalledWith([0.5, 1, 0, 1, 1, 1, 1, 1]);
  });

  it('the recording page’s mixer doesn’t reach the engine while the editor has it', () => {
    const { engine, s } = store();
    s.useMix('editor');
    vi.mocked(engine.setSlotLevels).mockClear();
    s.toggleMute(1);
    expect(engine.setSlotLevels).not.toHaveBeenCalled();
    expect(s.slotMuted[1]).toBe(true);
  });
});

describe('definePerformanceStore — the recording page’s last rifff', () => {
  it('remembers the last rifff played from the recording page, through stops and replays', async () => {
    const engine = mockEngine();
    const s = definePerformanceStore({ engine, prefetcher: mockPrefetcher(), resolveStems: vi.fn(async () => []) })();
    expect(s.lastPlayed).toBeNull();
    await s.hopTo(JAM, riff('r1'));
    s.stop();
    // A replay moving the engine on isn't the recording page playing.
    engine._emitRiff('elsewhere' as RiffCouchID);
    expect(s.lastPlayed).toEqual({ jamId: JAM, riff: riff('r1') });
  });
});

describe('definePerformanceStore — solo', () => {
  const store = () => {
    const engine = mockEngine();
    const s = definePerformanceStore({ engine, prefetcher: mockPrefetcher(), resolveStems: vi.fn() })();
    return { engine, s };
  };

  it('starts with nothing soloed', () => {
    expect(store().s.slotSoloed).toEqual([false, false, false, false, false, false, false, false]);
  });

  it('soloing a track plays only that track', () => {
    const { engine, s } = store();
    s.setSlotLevel(2, 0.6);
    s.toggleSolo(2);
    expect(engine.setSlotLevels).toHaveBeenLastCalledWith([0, 0, 0.6, 0, 0, 0, 0, 0]);
  });

  it('each further solo adds its track to what plays', () => {
    const { engine, s } = store();
    s.toggleSolo(2);
    s.toggleSolo(5);
    expect(engine.setSlotLevels).toHaveBeenLastCalledWith([0, 0, 1, 0, 0, 1, 0, 0]);
  });

  it('turning one solo off leaves the others soloed', () => {
    const { engine, s } = store();
    s.toggleSolo(2);
    s.toggleSolo(5);
    s.toggleSolo(2);
    expect(s.slotSoloed[5]).toBe(true);
    expect(engine.setSlotLevels).toHaveBeenLastCalledWith([0, 0, 0, 0, 0, 1, 0, 0]);
  });

  it('with the last solo off, every track plays again', () => {
    const { engine, s } = store();
    s.toggleSolo(2);
    s.toggleSolo(2);
    expect(engine.setSlotLevels).toHaveBeenLastCalledWith([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('un-solo clears every solo at once, leaving mutes as they were', () => {
    const { engine, s } = store();
    s.toggleMute(1);
    s.toggleSolo(2);
    s.toggleSolo(5);
    expect(s.anySoloed).toBe(true);
    s.clearSolos();
    expect(s.anySoloed).toBe(false);
    expect(engine.setSlotLevels).toHaveBeenLastCalledWith([1, 0, 1, 1, 1, 1, 1, 1]);
  });

  it('a muted track stays silent even when soloed', () => {
    const { engine, s } = store();
    s.toggleMute(2);
    s.toggleSolo(2);
    s.toggleSolo(3);
    expect(engine.setSlotLevels).toHaveBeenLastCalledWith([0, 0, 0, 1, 0, 0, 0, 0]);
  });

  it('says which tracks are being heard, for the mixer and waveform', () => {
    const { s } = store();
    s.toggleMute(0);
    s.toggleSolo(3);
    expect(s.slotAudible).toEqual([false, false, false, true, false, false, false, false]);
  });

  it('is the recording page’s: the editor still hears the rifffs’ own mix', () => {
    const { engine, s } = store();
    s.toggleSolo(3);
    s.useMix('editor');
    expect(engine.setSlotLevels).toHaveBeenLastCalledWith([1, 1, 1, 1, 1, 1, 1, 1]);
  });
});
