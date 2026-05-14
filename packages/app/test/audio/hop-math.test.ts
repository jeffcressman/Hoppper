import { describe, it, expect } from 'vitest';
import { computeHop } from '../../src/audio/hop-math.js';

describe('computeHop', () => {
  it('schedules the new riff at now + crossfadeSec', () => {
    const r = computeHop({
      now: 10,
      prevStart: 0,
      prevLoopDur: 16,
      newLoopDur: 16,
      crossfadeSec: 0.25,
    });
    expect(r.startWhen).toBeCloseTo(10.25, 6);
  });

  it('elapsedInPrev = (now + crossfadeSec - prevStart) mod prevLoopDur', () => {
    // prevStart=0, loop=16. now+crossfade=10.25 → elapsed 10.25.
    const r = computeHop({
      now: 10,
      prevStart: 0,
      prevLoopDur: 16,
      newLoopDur: 16,
      crossfadeSec: 0.25,
    });
    expect(r.elapsedInPrev).toBeCloseTo(10.25, 6);
  });

  it('wraps elapsedInPrev across the previous loop boundary', () => {
    // prevStart=0, prevLoopDur=8. Now+crossfade=10 → 10 mod 8 = 2.
    const r = computeHop({
      now: 9.75,
      prevStart: 0,
      prevLoopDur: 8,
      newLoopDur: 16,
      crossfadeSec: 0.25,
    });
    expect(r.elapsedInPrev).toBeCloseTo(2, 6);
    // newLoopDur > elapsed → offset == elapsed.
    expect(r.offsetInNew).toBeCloseTo(2, 6);
  });

  it('wraps offsetInNew when elapsedInPrev exceeds newLoopDur', () => {
    // elapsedInPrev = 6 (in a 16s prev), newLoopDur=4 → offset = 6 mod 4 = 2.
    const r = computeHop({
      now: 6,
      prevStart: 0,
      prevLoopDur: 16,
      newLoopDur: 4,
      crossfadeSec: 0,
    });
    expect(r.elapsedInPrev).toBeCloseTo(6, 6);
    expect(r.offsetInNew).toBeCloseTo(2, 6);
  });

  it('handles a hop very near the previous loop end (offset close to 0 in new riff)', () => {
    // prev started 15.9s ago, loop=16, crossfade=0.1 → elapsed = 16.0 mod 16 = 0.
    const r = computeHop({
      now: 15.9,
      prevStart: 0,
      prevLoopDur: 16,
      newLoopDur: 8,
      crossfadeSec: 0.1,
    });
    expect(r.elapsedInPrev).toBeCloseTo(0, 6);
    expect(r.offsetInNew).toBeCloseTo(0, 6);
  });

  it('uses math-mod (non-negative) even if now + crossfadeSec < prevStart', () => {
    // Pathological: scheduled time precedes prevStart. Result must be in [0, prevLoopDur).
    const r = computeHop({
      now: 0,
      prevStart: 5,
      prevLoopDur: 4,
      newLoopDur: 4,
      crossfadeSec: 0,
    });
    expect(r.elapsedInPrev).toBeGreaterThanOrEqual(0);
    expect(r.elapsedInPrev).toBeLessThan(4);
  });

  it('snap-to-bar rounds startWhen up to the next bar boundary on the previous loop', () => {
    // prevStart=0, secPerBar=2. now+crossfade=3.1 → next bar boundary = 4.
    const r = computeHop({
      now: 3,
      prevStart: 0,
      prevLoopDur: 16,
      newLoopDur: 16,
      crossfadeSec: 0.1,
      snapToBar: true,
      prevSecPerBar: 2,
    });
    expect(r.startWhen).toBeCloseTo(4, 6);
    expect(r.elapsedInPrev).toBeCloseTo(4, 6);
    expect(r.offsetInNew).toBeCloseTo(4, 6);
  });

  it('snap-to-bar leaves startWhen alone when already on a bar boundary', () => {
    // now+crossfade = 4.0, secPerBar=2 → already on boundary, no shift.
    const r = computeHop({
      now: 4,
      prevStart: 0,
      prevLoopDur: 16,
      newLoopDur: 16,
      crossfadeSec: 0,
      snapToBar: true,
      prevSecPerBar: 2,
    });
    expect(r.startWhen).toBeCloseTo(4, 6);
  });

  it('hop with no crossfade lands at now', () => {
    const r = computeHop({
      now: 7.5,
      prevStart: 0,
      prevLoopDur: 16,
      newLoopDur: 16,
      crossfadeSec: 0,
    });
    expect(r.startWhen).toBeCloseTo(7.5, 6);
    expect(r.offsetInNew).toBeCloseTo(7.5, 6);
  });

  it('phase-lock is positional, not proportional — same seconds-into-loop, regardless of loop length', () => {
    // Phase-lock per the design doc: positional (seconds), not tempo-locked.
    // At 4s into a 16s prev loop, the new 8s loop starts at offset 4s
    // (4 mod 8 = 4), so absolute beat positions line up.
    const r = computeHop({
      now: 4,
      prevStart: 0,
      prevLoopDur: 16,
      newLoopDur: 8,
      crossfadeSec: 0,
    });
    expect(r.elapsedInPrev).toBeCloseTo(4, 6);
    expect(r.offsetInNew).toBeCloseTo(4, 6);
  });
});
