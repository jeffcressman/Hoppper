import { describe, it, expect } from 'vitest';
import type { RiffDocument } from '@hoppper/sdk';
import { computeRiffTiming } from '../../src/audio/riff-timing.js';

function riff(partial: Partial<RiffDocument>): RiffDocument {
  // Defaults are placeholder; computeRiffTiming only reads bps + barLength.
  return {
    riffId: 'r' as RiffDocument['riffId'],
    jamId: 'j' as RiffDocument['jamId'],
    userName: 'u',
    createdAt: 0,
    bps: 2,
    bpm: 120,
    barLength: 16,
    root: 0,
    scale: 0,
    slots: [],
    ...partial,
  };
}

describe('computeRiffTiming', () => {
  it('derives quarter-beat count from 16th-note barLength (16 / 4 = 4)', () => {
    const t = computeRiffTiming(riff({ bps: 2, barLength: 16 }));
    expect(t.quarterBeats).toBe(4);
  });

  it('reports bpm as bps * 60', () => {
    const t = computeRiffTiming(riff({ bps: 2 }));
    expect(t.bpm).toBeCloseTo(120, 5);
  });

  it('secPerBar = quarterBeats / bps', () => {
    // 120 BPM, 4/4 bar: 2 seconds per bar.
    const t = computeRiffTiming(riff({ bps: 2, barLength: 16 }));
    expect(t.secPerBar).toBeCloseTo(2.0, 5);
  });

  it('barCount caps at 8 when 8 * secPerBar < 60', () => {
    // bps=2, 4/4 → secPerBar=2 → 8*2=16 < 60 → barCount=8
    const t = computeRiffTiming(riff({ bps: 2, barLength: 16 }));
    expect(t.barCount).toBe(8);
    expect(t.loopDurationSec).toBeCloseTo(16, 5);
  });

  it('barCount drops to 4 when 8 * secPerBar >= 60', () => {
    // secPerBar=8 → 8*8=64 >= 60 → try 4: 4*8=32 < 60 → barCount=4
    // pick bps and barLength yielding secPerBar=8: bps=0.5, barLength=16 → quarter=4 → 4/0.5=8
    const t = computeRiffTiming(riff({ bps: 0.5, barLength: 16 }));
    expect(t.secPerBar).toBeCloseTo(8, 5);
    expect(t.barCount).toBe(4);
    expect(t.loopDurationSec).toBeCloseTo(32, 5);
  });

  it('barCount drops to 2 when 4 * secPerBar >= 60', () => {
    // secPerBar=16 → 4*16=64 >= 60 → 2*16=32 < 60 → barCount=2
    // bps=0.25, barLength=16 → quarter=4 → 4/0.25=16
    const t = computeRiffTiming(riff({ bps: 0.25, barLength: 16 }));
    expect(t.secPerBar).toBeCloseTo(16, 5);
    expect(t.barCount).toBe(2);
    expect(t.loopDurationSec).toBeCloseTo(32, 5);
  });

  it('barCount drops to 1 when 2 * secPerBar >= 60', () => {
    // secPerBar=32 → 2*32=64 >= 60 → barCount=1
    // bps=0.125, barLength=16 → 4/0.125=32
    const t = computeRiffTiming(riff({ bps: 0.125, barLength: 16 }));
    expect(t.secPerBar).toBeCloseTo(32, 5);
    expect(t.barCount).toBe(1);
    expect(t.loopDurationSec).toBeCloseTo(32, 5);
  });

  it('barCount floors at 1 even when 1 * secPerBar >= 60 (pathological)', () => {
    // secPerBar=70 → no power-of-two fits under 60 → barCount=1 (floor)
    // bps=0.05, barLength=14 → quarter=trunc(14/4)=3 → 3/0.05=60 (boundary) → bump barLength
    const t = computeRiffTiming(riff({ bps: 0.05, barLength: 16 }));
    // quarter=4, sec=4/0.05=80 → all power-of-twos >= 60 → barCount=1
    expect(t.secPerBar).toBeCloseTo(80, 5);
    expect(t.barCount).toBe(1);
    expect(t.loopDurationSec).toBeCloseTo(80, 5);
  });

  it('truncates non-integer quarterBeats toward zero (matches C++ int32_t cast)', () => {
    // barLength=15 → 15/4=3.75 → trunc → 3 quarter beats
    const t = computeRiffTiming(riff({ bps: 2, barLength: 15 }));
    expect(t.quarterBeats).toBe(3);
    expect(t.secPerBar).toBeCloseTo(1.5, 5);
  });

  it('matches a worked LORE example: 120 BPM, barLength=16 → 8 bars, 16s loop', () => {
    // From live.riff.cpp commentary: 120 BPM, 4/4 → 2 BPS, 2s/bar, 8 bars, 16s.
    const t = computeRiffTiming(riff({ bps: 2, barLength: 16 }));
    expect(t.bpm).toBeCloseTo(120, 5);
    expect(t.quarterBeats).toBe(4);
    expect(t.secPerBar).toBeCloseTo(2, 5);
    expect(t.barCount).toBe(8);
    expect(t.loopDurationSec).toBeCloseTo(16, 5);
  });

  it('matches LORE clamp example: 25 BPM, 16/4 → length clamped under 60', () => {
    // bps = 25/60 ≈ 0.4167, quarter=4, secPerBar = 4/0.4167 ≈ 9.6
    // 8*9.6 = 76.8 >= 60 → barCount=4 → loop ≈ 38.4s
    const t = computeRiffTiming(riff({ bps: 25 / 60, barLength: 16 }));
    expect(t.bpm).toBeCloseTo(25, 1);
    expect(t.secPerBar).toBeCloseTo(9.6, 1);
    expect(t.barCount).toBe(4);
    expect(t.loopDurationSec).toBeLessThan(60);
  });
});
