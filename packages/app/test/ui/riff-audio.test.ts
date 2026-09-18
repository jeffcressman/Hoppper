import { describe, it, expect, vi } from 'vitest';
import type { RiffDocument, StemDocument } from '@hoppper/sdk';
import { riffStemAudio, stemPeaks } from '../../src/ui/riff-audio';

// bps 2, 16-sixteenth bars: 2 s bars, 8 of them — a 16 s computed loop.
function riff(stems: Array<string | null>): RiffDocument {
  return {
    riffId: 'r1',
    bps: 2,
    barLength: 16,
    slots: Array.from({ length: 8 }, (_, i) =>
      stems[i] ? { on: true, stemId: stems[i]!, gain: 1 } : { on: false, stemId: null, gain: 0 },
    ),
  } as RiffDocument;
}

function decoded(duration: number) {
  const data = new Float32Array(32).fill(0.5);
  return { numberOfChannels: 1, length: 32, sampleRate: 32 / duration, duration, getChannelData: vi.fn(() => data) };
}

const docs: Record<string, Partial<StemDocument>> = {
  a: { bps: 2 },
  half: { bps: 1 }, // recorded at half the rifff's tempo: plays twice as fast
};

describe('riffStemAudio', () => {
  it('gives each slot’s decoded stem and its length in rifff time', () => {
    const buffers: Record<string, ReturnType<typeof decoded>> = { a: decoded(8), half: decoded(8) };
    const { stems } = riffStemAudio(riff(['a', null, 'half']), (id) => docs[id] as StemDocument, (id) => buffers[id]);
    expect(stems[0]?.loopSec).toBe(8);
    expect(stems[1]).toBeNull();
    expect(stems[2]?.loopSec).toBe(4);
  });

  it('is the loop as it plays: the computed length, pushed out to fit the longest stem', () => {
    const short = riffStemAudio(riff(['a']), (id) => docs[id] as StemDocument, () => decoded(8));
    expect(short.loopSec).toBe(16);
    const long = riffStemAudio(riff(['a']), (id) => docs[id] as StemDocument, () => decoded(32));
    expect(long.loopSec).toBe(32);
  });

  it('has nothing for a stem that isn’t decoded yet', () => {
    const { stems } = riffStemAudio(riff(['a']), (id) => docs[id] as StemDocument, () => undefined);
    expect(stems[0]).toBeNull();
  });
});

describe('stemPeaks', () => {
  it('reads a stem’s audio once, however often it is asked', () => {
    const buffer = decoded(8);
    const first = stemPeaks('once', buffer);
    const again = stemPeaks('once', buffer);
    expect(again).toBe(first);
    expect(buffer.getChannelData).toHaveBeenCalledTimes(1);
  });
});
