import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { JamCouchID } from '@hoppper/sdk';
import { defineRecorderStore } from '../../src/stores/recorder';
import type { HopRecorder, RecorderState } from '../../src/hop-recorder/recorder';
import type { SequenceStorage } from '../../src/hop-recorder/storage';
import type { HopPlayer } from '../../src/hop-recorder/player';
import type { HopSequence } from '../../src/hop-recorder/types';

const JAM = 'band-A' as JamCouchID;

function fixtureSeq(overrides: Partial<HopSequence> = {}): HopSequence {
  return {
    schemaVersion: 1,
    id: 'seq-1',
    title: 'Take 1',
    jamId: JAM,
    recordedAt: '2026-05-14T00:00:00.000Z',
    durationSec: 10,
    hops: [{ tSec: 0, riffId: 'r1', jamId: JAM, transitionMs: 0 }],
    ...overrides,
  };
}

function mockRecorder(): HopRecorder {
  let state: RecorderState = 'idle';
  let lastSeq: HopSequence | null = null;
  const listeners = new Set<(s: RecorderState) => void>();
  const emit = (s: RecorderState) => {
    state = s;
    for (const l of listeners) l(s);
  };
  return {
    get state() {
      return state;
    },
    get isRecording() {
      return state !== 'idle';
    },
    start: vi.fn((opts) => {
      lastSeq = fixtureSeq({ jamId: opts.jamId, title: opts.title ?? 'Untitled', hops: [] });
      emit('armed');
    }),
    recordHop: vi.fn((event) => {
      lastSeq!.hops.push({ tSec: lastSeq!.hops.length, ...event });
      if (state === 'armed') emit('recording');
    }),
    stop: vi.fn(() => {
      emit('idle');
      return lastSeq!;
    }),
    onStateChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function mockStorage(): SequenceStorage & {
  _saved: Map<string, HopSequence>;
} {
  const _saved = new Map<string, HopSequence>();
  return {
    _saved,
    saveSequence: vi.fn(async (s) => {
      _saved.set(`${s.jamId}/${s.id}`, s);
    }),
    loadSequence: vi.fn(async (j, id) => _saved.get(`${j}/${id}`)!),
    listSequences: vi.fn(async (j) =>
      [..._saved.values()].filter((s) => s.jamId === j),
    ),
    deleteSequence: vi.fn(async (j, id) => {
      _saved.delete(`${j}/${id}`);
    }),
  };
}

/**
 * `loading`, when given, holds play() open after it has gone 'playing' — as
 * the real player does while it loads the first rifffs.
 */
function mockPlayer(loading?: Promise<void>): HopPlayer {
  let state: 'idle' | 'playing' = 'idle';
  const listeners = new Set<(s: 'idle' | 'playing') => void>();
  const emit = (s: 'idle' | 'playing') => {
    state = s;
    for (const l of listeners) l(s);
  };
  return {
    get state() {
      return state;
    },
    play: vi.fn(async () => {
      emit('playing');
      await loading;
    }),
    stop: vi.fn(() => {
      emit('idle');
    }),
    onStateChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

beforeEach(() => setActivePinia(createPinia()));

describe('defineRecorderStore', () => {
  it('start() puts the store in recording state', () => {
    const recorder = mockRecorder();
    const useStore = defineRecorderStore({
      recorder,
      storage: mockStorage(),
      player: mockPlayer(),
    });
    const store = useStore();
    expect(store.isRecording).toBe(false);
    store.start(JAM);
    expect(recorder.start).toHaveBeenCalledWith({ jamId: JAM, title: undefined });
    expect(store.isRecording).toBe(true);
  });

  it('stop() saves the captured sequence and refreshes the list', async () => {
    const recorder = mockRecorder();
    const storage = mockStorage();
    const useStore = defineRecorderStore({
      recorder,
      storage,
      player: mockPlayer(),
    });
    const store = useStore();
    store.start(JAM, 'My Title');
    recorder.recordHop({ riffId: 'r1', jamId: JAM, transitionMs: 0 });
    await store.stop();
    expect(storage.saveSequence).toHaveBeenCalled();
    expect(store.isRecording).toBe(false);
    // saved list now contains the sequence
    expect(store.saved.length).toBe(1);
  });

  it('is armed after start() until the first hop is recorded', () => {
    // The performance store records hops straight into the HopRecorder, so
    // the store learns about the first one from the recorder, not from a call.
    const recorder = mockRecorder();
    const useStore = defineRecorderStore({
      recorder,
      storage: mockStorage(),
      player: mockPlayer(),
    });
    const store = useStore();
    expect(store.isArmed).toBe(false);

    store.start(JAM);
    expect(store.isArmed).toBe(true);
    expect(store.isRecording).toBe(true);

    recorder.recordHop({ riffId: 'r1', jamId: JAM, transitionMs: 0 });
    expect(store.isArmed).toBe(false);
    expect(store.isRecording).toBe(true);
  });

  it('stop() before any rifff was clicked saves nothing', async () => {
    const recorder = mockRecorder();
    const storage = mockStorage();
    const useStore = defineRecorderStore({
      recorder,
      storage,
      player: mockPlayer(),
    });
    const store = useStore();
    store.start(JAM);
    const seq = await store.stop();
    expect(seq).toBeNull();
    expect(storage.saveSequence).not.toHaveBeenCalled();
    expect(store.isRecording).toBe(false);
    expect(store.isArmed).toBe(false);
  });

  it('tracks which sequence is playing until the replay ends or is stopped', async () => {
    const player = mockPlayer();
    const useStore = defineRecorderStore({
      recorder: mockRecorder(),
      storage: mockStorage(),
      player,
    });
    const store = useStore();
    expect(store.playingId).toBeNull();

    await store.play(fixtureSeq({ id: 'take-2' }));
    expect(store.playingId).toBe('take-2');
    // The replay reaches its end on its own.
    player.stop();
    expect(store.playingId).toBeNull();

    await store.play(fixtureSeq({ id: 'take-3' }));
    store.stopPlayback();
    expect(store.playingId).toBeNull();
  });

  it('stopPlayback() while a replay is still loading leaves nothing marked playing', async () => {
    let finishLoading!: () => void;
    const player = mockPlayer(new Promise<void>((resolve) => (finishLoading = resolve)));

    const useStore = defineRecorderStore({
      recorder: mockRecorder(),
      storage: mockStorage(),
      player,
    });
    const store = useStore();
    const playing = store.play(fixtureSeq({ id: 'take-4' }));
    expect(store.playingId).toBe('take-4');
    store.stopPlayback();
    finishLoading();
    await playing;

    expect(store.isPlaying).toBe(false);
    expect(store.playingId).toBeNull();
  });

  it('start() while playing throws', async () => {
    const recorder = mockRecorder();
    const player = mockPlayer();
    const useStore = defineRecorderStore({
      recorder,
      storage: mockStorage(),
      player,
    });
    const store = useStore();
    await store.play(fixtureSeq());
    expect(() => store.start(JAM)).toThrow(/playing/i);
  });

  it('play() while recording throws', async () => {
    const recorder = mockRecorder();
    const useStore = defineRecorderStore({
      recorder,
      storage: mockStorage(),
      player: mockPlayer(),
    });
    const store = useStore();
    store.start(JAM);
    await expect(store.play(fixtureSeq())).rejects.toThrow(/recording/i);
  });

  it('loadSaved(jamId) populates saved list filtered to that jam', async () => {
    const storage = mockStorage();
    storage._saved.set(`${JAM}/a`, fixtureSeq({ id: 'a' }));
    storage._saved.set(`${JAM}/b`, fixtureSeq({ id: 'b' }));
    storage._saved.set(`other/c`, fixtureSeq({ id: 'c', jamId: 'other' }));
    const useStore = defineRecorderStore({
      recorder: mockRecorder(),
      storage,
      player: mockPlayer(),
    });
    const store = useStore();
    await store.loadSaved(JAM);
    expect(store.saved.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('play(seq) delegates to the player and tracks isPlaying', async () => {
    const player = mockPlayer();
    const useStore = defineRecorderStore({
      recorder: mockRecorder(),
      storage: mockStorage(),
      player,
    });
    const store = useStore();
    await store.play(fixtureSeq());
    expect(player.play).toHaveBeenCalled();
    expect(store.isPlaying).toBe(true);
  });

  it('isPlaying flips back to false when the player naturally finishes', async () => {
    // Simulates the player's scheduled final-stop firing — without an
    // observer the store would stick at isPlaying=true and the next
    // play() would throw "already playing".
    const player = mockPlayer();
    let emit: ((s: 'idle' | 'playing') => void) | null = null;
    const origOnStateChange = player.onStateChange.bind(player);
    player.onStateChange = (fn) => {
      emit = fn;
      return origOnStateChange(fn);
    };
    const useStore = defineRecorderStore({
      recorder: mockRecorder(),
      storage: mockStorage(),
      player,
    });
    const store = useStore();
    await store.play(fixtureSeq());
    expect(store.isPlaying).toBe(true);
    emit!('idle');
    expect(store.isPlaying).toBe(false);
  });

  it('stopPlayback() delegates to the player and resets isPlaying', async () => {
    const player = mockPlayer();
    const useStore = defineRecorderStore({
      recorder: mockRecorder(),
      storage: mockStorage(),
      player,
    });
    const store = useStore();
    await store.play(fixtureSeq());
    store.stopPlayback();
    expect(player.stop).toHaveBeenCalled();
    expect(store.isPlaying).toBe(false);
  });

  it('delete(jamId, id) removes the sequence and refreshes the list', async () => {
    const storage = mockStorage();
    storage._saved.set(`${JAM}/a`, fixtureSeq({ id: 'a' }));
    const useStore = defineRecorderStore({
      recorder: mockRecorder(),
      storage,
      player: mockPlayer(),
    });
    const store = useStore();
    await store.loadSaved(JAM);
    expect(store.saved.length).toBe(1);
    await store.delete(JAM, 'a');
    expect(storage.deleteSequence).toHaveBeenCalledWith(JAM, 'a');
    expect(store.saved.length).toBe(0);
  });
});
