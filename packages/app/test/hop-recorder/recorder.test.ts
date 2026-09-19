import { describe, it, expect } from 'vitest';
import { createHopRecorder } from '../../src/hop-recorder/recorder.js';

const JAM = 'band-test';

function idGen(values: string[]): () => string {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe('createHopRecorder', () => {
  it('isRecording is false before start', () => {
    const r = createHopRecorder({ clock: () => 0, idGen: () => 'id-1' });
    expect(r.isRecording).toBe(false);
  });

  it('start() transitions to isRecording', () => {
    const r = createHopRecorder({ clock: () => 10, idGen: () => 'id-1' });
    r.start({ jamId: JAM });
    expect(r.isRecording).toBe(true);
  });

  it('starts the timeline at the first hop, not at start()', () => {
    // Record only arms the recorder. Whatever time passes before the first
    // rifff is clicked is not part of the take, so replay doesn't open on
    // silence.
    const clock = { t: 100 };
    const r = createHopRecorder({ clock: () => clock.t, idGen: () => 'seq-1' });
    r.start({ jamId: JAM });
    clock.t = 105.5;
    r.recordHop({ riffId: 'r1', jamId: JAM, transitionMs: 0 });
    clock.t = 120;
    r.recordHop({ riffId: 'r2', jamId: JAM, transitionMs: 250 });
    clock.t = 130;
    const seq = r.stop();

    expect(seq.hops).toEqual([
      { tSec: 0, riffId: 'r1', jamId: JAM, transitionMs: 0 },
      { tSec: 14.5, riffId: 'r2', jamId: JAM, transitionMs: 250 },
    ]);
    expect(seq.durationSec).toBe(24.5);
  });

  it('registers a hop at the time it is given, not when recordHop runs', () => {
    // The caller passes the moment playback of the rifff actually began —
    // after it loaded — so the take lines up with what was heard.
    const clock = { t: 100 };
    const r = createHopRecorder({ clock: () => clock.t, idGen: () => 'seq-1' });
    r.start({ jamId: JAM });
    clock.t = 103;
    r.recordHop({ riffId: 'r1', jamId: JAM, transitionMs: 0 }, 102);
    clock.t = 112;
    r.recordHop({ riffId: 'r2', jamId: JAM, transitionMs: 250, quantise: 'beat' }, 110.5);
    clock.t = 120;
    const seq = r.stop();

    expect(seq.hops).toEqual([
      { tSec: 0, riffId: 'r1', jamId: JAM, transitionMs: 0 },
      { tSec: 8.5, riffId: 'r2', jamId: JAM, transitionMs: 250, quantise: 'beat' },
    ]);
    expect(seq.durationSec).toBe(18);
  });

  it('is armed until the first hop, then recording', () => {
    const r = createHopRecorder({ clock: () => 0, idGen: () => 'id' });
    const states: string[] = [];
    r.onStateChange((s) => states.push(s));
    expect(r.state).toBe('idle');

    r.start({ jamId: JAM });
    expect(r.state).toBe('armed');
    // Armed still counts as recording: the first click must be captured.
    expect(r.isRecording).toBe(true);

    r.recordHop({ riffId: 'r1', jamId: JAM, transitionMs: 0 });
    r.recordHop({ riffId: 'r2', jamId: JAM, transitionMs: 0 });
    expect(r.state).toBe('recording');

    r.stop();
    expect(r.state).toBe('idle');
    expect(states).toEqual(['armed', 'recording', 'idle']);
  });

  it('stop() while still armed gives an empty take of no length', () => {
    const clock = { t: 50 };
    const r = createHopRecorder({ clock: () => clock.t, idGen: () => 'id' });
    r.start({ jamId: JAM });
    clock.t = 80;
    const seq = r.stop();
    expect(seq.hops).toEqual([]);
    expect(seq.durationSec).toBe(0);
  });

  it('recordHop outside start/stop is a no-op', () => {
    const r = createHopRecorder({ clock: () => 0, idGen: () => 'id' });
    // Before start
    r.recordHop({ riffId: 'r-pre', jamId: JAM, transitionMs: 0 });
    r.start({ jamId: JAM });
    r.recordHop({ riffId: 'r-during', jamId: JAM, transitionMs: 0 });
    const seq = r.stop();
    // After stop
    r.recordHop({ riffId: 'r-post', jamId: JAM, transitionMs: 0 });
    expect(seq.hops.map((h) => h.riffId)).toEqual(['r-during']);
  });

  it('produces a HopSequence with schemaVersion 1 and a stable id', () => {
    const r = createHopRecorder({
      clock: () => 0,
      idGen: idGen(['seq-xyz']),
    });
    r.start({ jamId: JAM });
    const seq = r.stop();
    expect(seq.schemaVersion).toBe(1);
    expect(seq.id).toBe('seq-xyz');
  });

  it('records jamId at the sequence level from start({ jamId })', () => {
    const r = createHopRecorder({ clock: () => 0, idGen: () => 'id' });
    r.start({ jamId: 'jam-A' });
    const seq = r.stop();
    expect(seq.jamId).toBe('jam-A');
  });

  it('uses provided title; defaults to ISO recordedAt', () => {
    const r1 = createHopRecorder({ clock: () => 0, idGen: () => 'id' });
    r1.start({ jamId: JAM, title: 'My Set' });
    expect(r1.stop().title).toBe('My Set');

    const r2 = createHopRecorder({ clock: () => 0, idGen: () => 'id' });
    r2.start({ jamId: JAM });
    const seq = r2.stop();
    expect(seq.title).toBe(seq.recordedAt);
  });

  it('start() while recording throws', () => {
    const r = createHopRecorder({ clock: () => 0, idGen: () => 'id' });
    r.start({ jamId: JAM });
    expect(() => r.start({ jamId: JAM })).toThrow(/already recording/i);
  });

  it('stop() without start throws', () => {
    const r = createHopRecorder({ clock: () => 0, idGen: () => 'id' });
    expect(() => r.stop()).toThrow(/not recording/i);
  });

  it('isRecording is false after stop', () => {
    const r = createHopRecorder({ clock: () => 0, idGen: () => 'id' });
    r.start({ jamId: JAM });
    r.stop();
    expect(r.isRecording).toBe(false);
  });
});

describe('createHopRecorder — mixer automation', () => {
  const unity = { volume: [1, 1, 1, 1, 1, 1, 1, 1], mute: Array(8).fill(false), solo: Array(8).fill(false) };

  function recording(start = 100) {
    const clock = { t: start };
    const r = createHopRecorder({ clock: () => clock.t, idGen: () => 'seq-1' });
    r.start({ jamId: JAM });
    return { clock, r };
  }

  it('starts every track’s lines from the mixer as it stands at the first rifff', () => {
    const { clock, r } = recording();
    r.recordHop({ riffId: 'r1', jamId: JAM, transitionMs: 0 });
    r.startMix({ ...unity, volume: [0.5, 1, 1, 1, 1, 1, 1, 1], mute: [false, true, false, false, false, false, false, false] });
    clock.t = 110;
    const seq = r.stop();
    expect(seq.automation).toHaveLength(8);
    expect(seq.automation![0]!.volume).toEqual([{ tSec: 0, value: 0.5 }]);
    expect(seq.automation![1]!.mute).toEqual([{ tSec: 0, value: 1 }]);
    expect(seq.automation![2]!.solo).toEqual([{ tSec: 0, value: 0 }]);
  });

  it('records each mixer move at its time in the take', () => {
    const { clock, r } = recording();
    r.recordHop({ riffId: 'r1', jamId: JAM, transitionMs: 0 });
    r.startMix(unity);
    clock.t = 104;
    r.recordMix({ slot: 3, param: 'mute', value: 1 });
    clock.t = 106.5;
    r.recordMix({ slot: 3, param: 'solo', value: 1 }, 106);
    clock.t = 110;
    const seq = r.stop();
    expect(seq.automation![3]!.mute).toEqual([{ tSec: 0, value: 0 }, { tSec: 4, value: 1 }]);
    expect(seq.automation![3]!.solo).toEqual([{ tSec: 0, value: 0 }, { tSec: 6, value: 1 }]);
  });

  it('keeps a fader drag to a point every 30 ms at most', () => {
    const { clock, r } = recording();
    r.recordHop({ riffId: 'r1', jamId: JAM, transitionMs: 0 });
    r.startMix(unity);
    for (const [t, v] of [[101, 0.9], [101.01, 0.8], [101.02, 0.7], [101.05, 0.6]] as const) {
      clock.t = t;
      r.recordMix({ slot: 0, param: 'volume', value: v });
    }
    const points = r.stop().automation![0]!.volume;
    expect(points.map((p) => p.value)).toEqual([1, 0.7, 0.6]);
  });

  it('ignores mixer moves before the first rifff — they only set where it starts', () => {
    const { r } = recording();
    r.recordMix({ slot: 0, param: 'mute', value: 1 });
    r.recordHop({ riffId: 'r1', jamId: JAM, transitionMs: 0 });
    r.startMix(unity);
    expect(r.stop().automation![0]!.mute).toEqual([{ tSec: 0, value: 0 }]);
  });

  it('a take with no hops has no automation', () => {
    const { r } = recording();
    expect(r.stop().automation).toBeUndefined();
  });
});
