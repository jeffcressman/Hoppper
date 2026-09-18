import { describe, it, expect } from 'vitest';
import type { RiffDocument, StemDocument } from '@hoppper/sdk';
import { riffSplat } from '../../src/ui/splat';

function riff(slots: Array<[stemId: string, gain: number] | null>): RiffDocument {
  return {
    riffId: 'r1',
    jamId: 'band1',
    userName: 'lwlkc',
    createdAt: 0,
    bps: 2,
    bpm: 120,
    barLength: 16,
    root: 0,
    scale: 0,
    slots: Array.from({ length: 8 }, (_, i) => {
      const s = slots[i];
      return s ? { on: true, stemId: s[0], gain: s[1] } : { on: false, stemId: null, gain: 0 };
    }),
  };
}

const doc = (colour: string) => ({ primaryColour: colour }) as StemDocument;
const docs: Record<string, StemDocument | null> = {
  drums: doc('ffe07b39'),
  bass: doc('ff4d9de0'),
  keys: doc('ffe6d74b'),
  gone: null,
};
const docOf = (id: string) => docs[id];

describe('riffSplat', () => {
  it('draws one layer per stem that is playing', () => {
    const splat = riffSplat(riff([['drums', 1], null, ['bass', 1], ['keys', 1]]), docOf);
    expect(splat.layers).toHaveLength(3);
  });

  it('colours each layer with its stem’s own colour', () => {
    const splat = riffSplat(riff([['bass', 1]]), docOf);
    expect(splat.layers[0].colour).toBe('rgb(77 157 224)');
  });

  it('puts the loudest stem at the bottom, biggest, so quieter ones stay visible on top', () => {
    const splat = riffSplat(riff([['keys', 0.3], ['drums', 0.9], ['bass', 0.6]]), docOf);
    expect(splat.layers.map((l) => l.colour)).toEqual([
      'rgb(224 123 57)',
      'rgb(77 157 224)',
      'rgb(230 215 75)',
    ]);
    const extent = (d: string) => Math.max(...d.match(/-?\d+(\.\d+)?/g)!.map(Number).map((n) => Math.abs(n - 50)));
    expect(extent(splat.layers[0].d)).toBeGreaterThan(extent(splat.layers[2].d));
  });

  it('greys out a stem Endlesss has no document for', () => {
    const splat = riffSplat(riff([['gone', 1]]), docOf);
    expect(splat.layers[0].colour).toBe('var(--text-4)');
    expect(splat.pending).toBe(false);
  });

  it('is pending while any stem document is still being fetched', () => {
    const splat = riffSplat(riff([['drums', 1], ['not-fetched-yet', 1]]), docOf);
    expect(splat.pending).toBe(true);
  });

  it('draws a stem the same way in every rifff it appears in', () => {
    const a = riffSplat(riff([['bass', 1]]), docOf);
    const b = riffSplat({ ...riff([['bass', 1]]), riffId: 'r2' }, docOf);
    expect(a.layers[0].d).toBe(b.layers[0].d);
  });

  it('stays inside its 100×100 box', () => {
    const splat = riffSplat(
      riff(Array.from({ length: 8 }, (_, i) => [`s${i}`, 1] as [string, number])),
      () => doc('ffffffff'),
    );
    const coords = splat.layers.flatMap((l) => l.d.match(/-?\d+(\.\d+)?/g)!.map(Number));
    expect(Math.min(...coords)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...coords)).toBeLessThanOrEqual(100);
  });

  it('a silent rifff has nothing to draw', () => {
    expect(riffSplat(riff([]), docOf)).toEqual({ layers: [], pending: false });
  });
});
