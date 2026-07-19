import { describe, it, expect } from 'vitest';
import { createHopRecorder } from '../../src/hop-recorder/recorder.js';

const JAM = 'band-test';

function fixedClock(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i += 1;
    return v;
  };
}

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

  it('records hops with tSec relative to the start clock value', () => {
    // Clock values consumed: start (=100), hop1 (=105.5), hop2 (=120), stop (=130)
    const r = createHopRecorder({
      clock: fixedClock([100, 105.5, 120, 130]),
      idGen: () => 'seq-1',
    });
    r.start({ jamId: JAM });
    r.recordHop({ riffId: 'r1', jamId: JAM, transitionMs: 0 });
    r.recordHop({ riffId: 'r2', jamId: JAM, transitionMs: 250 });
    const seq = r.stop();

    expect(seq.hops).toEqual([
      { tSec: 5.5, riffId: 'r1', jamId: JAM, transitionMs: 0 },
      { tSec: 20, riffId: 'r2', jamId: JAM, transitionMs: 250 },
    ]);
    expect(seq.durationSec).toBe(30);
  });

  it('first hop is tSec=0 when the click coincides with start', () => {
    // Same clock reading at start() and first recordHop() — user clicked
    // Record and the first riff in the same tick.
    const r = createHopRecorder({
      clock: fixedClock([50, 50, 60]),
      idGen: () => 'id',
    });
    r.start({ jamId: JAM });
    r.recordHop({ riffId: 'r1', jamId: JAM, transitionMs: 0 });
    const seq = r.stop();
    expect(seq.hops[0].tSec).toBe(0);
    expect(seq.durationSec).toBe(10);
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
