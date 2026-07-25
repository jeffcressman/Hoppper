import { describe, it, expect } from 'vitest';
import { computeHop } from '../../src/audio/hop-math.js';

// Hopping picks playback up in the new rifff at the same relative point on a
// single continuous grid, running from the moment playback started. See
// docs/phases/phase-6-audio-engine.md → "Hop phase model".
describe('computeHop', () => {
  it('schedules the new rifff at now + crossfadeSec', () => {
    const r = computeHop({
      now: 10,
      gridOrigin: 0,
      newLoopDur: 16,
      crossfadeSec: 0.25,
    });
    expect(r.startWhen).toBeCloseTo(10.25, 6);
  });

  it('elapsedOnGrid is measured from the grid origin, not from the last hop', () => {
    const r = computeHop({
      now: 10,
      gridOrigin: 0,
      newLoopDur: 16,
      crossfadeSec: 0.25,
    });
    expect(r.elapsedOnGrid).toBeCloseTo(10.25, 6);
  });

  it('wraps the grid position into the new rifff loop', () => {
    // 10s onto the grid, hopping to a 4s rifff → 10 mod 4 = 2.
    const r = computeHop({
      now: 10,
      gridOrigin: 0,
      newLoopDur: 4,
      crossfadeSec: 0,
    });
    expect(r.elapsedOnGrid).toBeCloseTo(10, 6);
    expect(r.offsetInNew).toBeCloseTo(2, 6);
  });

  it('keeps the grid position when hopping to a LONGER rifff', () => {
    // The case the previous implementation could not express: 7 bars onto the
    // grid (2s bars), hopping to a 16-bar rifff lands at its bar 7, not bar 1.
    const r = computeHop({
      now: 14,
      gridOrigin: 0,
      newLoopDur: 32,
      crossfadeSec: 0,
    });
    expect(r.offsetInNew).toBeCloseTo(14, 6);
  });

  it('lands every loop length at the same point in the bar for one grid position', () => {
    // Same hop moment, four rifff lengths — the diagram in
    // local/issue resources: 2, 4, 8 and 16 bar rifffs at 2s per bar, hopped
    // into 7 bars (14s) onto the grid.
    const at = (newLoopDur: number) =>
      computeHop({ now: 14, gridOrigin: 0, newLoopDur, crossfadeSec: 0 }).offsetInNew;
    expect(at(4)).toBeCloseTo(2, 6); // 2-bar: bar 1 (7 mod 2)
    expect(at(8)).toBeCloseTo(6, 6); // 4-bar: bar 3 (7 mod 4)
    expect(at(16)).toBeCloseTo(14, 6); // 8-bar: bar 7 (7 mod 8)
    expect(at(32)).toBeCloseTo(14, 6); // 16-bar: bar 7
    // Every one of them sits at the same point within a 2s bar…
    for (const loop of [4, 8, 16, 32]) {
      expect(at(loop) % 2).toBeCloseTo(0, 6);
    }
  });

  it('hop with no crossfade lands at now', () => {
    const r = computeHop({
      now: 7.5,
      gridOrigin: 0,
      newLoopDur: 16,
      crossfadeSec: 0,
    });
    expect(r.startWhen).toBeCloseTo(7.5, 6);
    expect(r.offsetInNew).toBeCloseTo(7.5, 6);
  });

  it('handles a hop landing exactly on a loop boundary', () => {
    const r = computeHop({
      now: 15.9,
      gridOrigin: 0,
      newLoopDur: 8,
      crossfadeSec: 0.1,
    });
    expect(r.elapsedOnGrid).toBeCloseTo(16, 6);
    expect(r.offsetInNew).toBeCloseTo(0, 6);
  });

  it('uses math-mod (non-negative) even if the scheduled time precedes the origin', () => {
    const r = computeHop({
      now: 0,
      gridOrigin: 5,
      newLoopDur: 4,
      crossfadeSec: 0,
    });
    expect(r.offsetInNew).toBeGreaterThanOrEqual(0);
    expect(r.offsetInNew).toBeLessThan(4);
  });

  it('quantises startWhen up to the next interval on the grid', () => {
    // Grid origin 0, 2s interval. now + crossfade = 3.1 → next boundary is 4.
    const r = computeHop({
      now: 3,
      gridOrigin: 0,
      newLoopDur: 16,
      crossfadeSec: 0.1,
      quantiseSec: 2,
    });
    expect(r.startWhen).toBeCloseTo(4, 6);
    expect(r.offsetInNew).toBeCloseTo(4, 6);
    expect(r.quantiseDelaySec).toBeCloseTo(0.9, 6);
  });

  it('quantises to a beat as readily as to a bar', () => {
    // 0.5s beats: now + crossfade = 3.1 → next beat is 3.5.
    const r = computeHop({
      now: 3,
      gridOrigin: 0,
      newLoopDur: 16,
      crossfadeSec: 0.1,
      quantiseSec: 0.5,
    });
    expect(r.startWhen).toBeCloseTo(3.5, 6);
    expect(r.offsetInNew).toBeCloseTo(3.5, 6);
  });

  it('quantises against the grid origin, not against zero', () => {
    // Origin 29.5, 0.5s beats: 31.6 is 2.1 onto the grid → next beat is 2.5.
    const r = computeHop({
      now: 31.6,
      gridOrigin: 29.5,
      newLoopDur: 8,
      crossfadeSec: 0,
      quantiseSec: 0.5,
    });
    expect(r.startWhen).toBeCloseTo(32, 6);
    expect(r.offsetInNew).toBeCloseTo(2.5, 6);
  });

  it('leaves startWhen alone when it already sits on an interval boundary', () => {
    const r = computeHop({
      now: 4,
      gridOrigin: 0,
      newLoopDur: 16,
      crossfadeSec: 0,
      quantiseSec: 2,
    });
    expect(r.startWhen).toBeCloseTo(4, 6);
    expect(r.quantiseDelaySec).toBeCloseTo(0, 6);
  });

  it('treats a missing or unusable interval as no quantisation', () => {
    for (const quantiseSec of [undefined, 0, -1, Number.NaN]) {
      const r = computeHop({ now: 3.1, gridOrigin: 0, newLoopDur: 16, crossfadeSec: 0, quantiseSec });
      expect(r.startWhen).toBeCloseTo(3.1, 6);
      expect(r.quantiseDelaySec).toBe(0);
    }
  });

  it('reproduces the recorded off-beat session correctly', () => {
    // From local/issue resources: cold start at 29.50s, 8s loops, 120bpm, then
    // hops at these AudioContext times. The engine logged offsets of 2.17,
    // 1.93, 2.26 and 2.56 — each measured from the previous hop instead of
    // from the grid — which put the audio 0, 170, 100 and -140ms off the beat.
    const gridOrigin = 29.5;
    const expected: [number, number][] = [
      [31.67, 2.17],
      [33.6, 4.1],
      [35.86, 6.36],
      [38.42, 0.92],
    ];
    for (const [startWhen, offset] of expected) {
      const r = computeHop({
        now: startWhen,
        gridOrigin,
        newLoopDur: 8,
        crossfadeSec: 0,
      });
      expect(r.offsetInNew).toBeCloseTo(offset, 2);
      // …and every one of them is a whole number of 0.5s beats off the grid.
      expect((r.offsetInNew - ((startWhen - gridOrigin) % 8)) % 0.5).toBeCloseTo(0, 6);
    }
  });
});
