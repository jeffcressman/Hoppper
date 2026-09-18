import { describe, it, expect } from 'vitest';
import { bufferPeaks, loopRow, rowPath } from '../../src/ui/peaks';

function buffer(channels: number[][], sampleRate = 4) {
  return {
    numberOfChannels: channels.length,
    length: channels[0]!.length,
    sampleRate,
    duration: channels[0]!.length / sampleRate,
    getChannelData: (c: number) => Float32Array.from(channels[c]!),
  };
}

describe('bufferPeaks', () => {
  it('takes the loudest sample of each slice, across both channels', () => {
    const peaks = bufferPeaks(buffer([[0.1, -0.5, 0.2, 0.1], [0.3, 0.1, -0.9, 0]]), 2);
    expect(Array.from(peaks)).toEqual([0.5, expect.closeTo(0.9, 6)]);
  });

  it('gives as many slices as asked, even from a short buffer', () => {
    expect(bufferPeaks(buffer([[1, 0]]), 4)).toHaveLength(4);
  });
});

describe('loopRow', () => {
  const peaks = Float32Array.from([0.1, 0.9]);

  it('spreads a stem as long as the loop across it once', () => {
    expect(Array.from(loopRow(peaks, 8, 8, 4))).toEqual([
      expect.closeTo(0.1, 6), expect.closeTo(0.1, 6), expect.closeTo(0.9, 6), expect.closeTo(0.9, 6),
    ]);
  });

  it('repeats a shorter stem inside the loop, as it plays', () => {
    expect(Array.from(loopRow(peaks, 4, 8, 4))).toEqual([
      expect.closeTo(0.1, 6), expect.closeTo(0.9, 6), expect.closeTo(0.1, 6), expect.closeTo(0.9, 6),
    ]);
  });

  it('is silent for a stem with no usable length', () => {
    expect(Array.from(loopRow(peaks, 0, 8, 2))).toEqual([0, 0]);
  });
});

describe('rowPath', () => {
  it('draws a mirrored shape around the middle of a 20-high row', () => {
    const d = rowPath(Float32Array.from([1, 0]));
    expect(d.startsWith('M0 10')).toBe(true);
    expect(d).toContain('L0.5 1');
    expect(d).toContain('L0.5 19');
    expect(d.endsWith('Z')).toBe(true);
  });

  it('is empty for no values', () => {
    expect(rowPath(new Float32Array(0))).toBe('');
  });
});
