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

describe('riffSplat — drawn from the stems’ audio', () => {
  // Distance from the centre of each point of a path, in order.
  const radii = (d: string) => {
    const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const out: number[] = [];
    for (let i = 0; i < n.length; i += 2) out.push(Math.hypot(n[i]! - 50, n[i + 1]! - 50));
    return out;
  };

  // A ring is the stem's waveform once around the loop: highest then lowest
  // sample of each slice, in turn.
  const ring = (pairs: Array<[number, number]>) => Float32Array.from(pairs.flat());

  it('wraps a decoded stem’s waveform around the circle: peaks reach out, troughs cut in', () => {
    const shape = ring(Array.from({ length: 8 }, () => [0.8, -0.8]));
    const splat = riffSplat(riff([['bass', 1]]), docOf, (id) => (id === 'bass' ? shape : undefined));
    const r = radii(splat.layers[0]!.d);
    expect(r).toHaveLength(16);
    expect(r[0]!).toBeGreaterThan(r[1]! * 2);
    expect(Math.abs(r[2]! - r[0]!)).toBeLessThan(0.2); // path coords are rounded to 0.1
  });

  it('cuts troughs in towards the centre without ever crossing it', () => {
    const shape = ring(Array.from({ length: 8 }, () => [1, -1]));
    const d = riffSplat(riff([['bass', 1]]), docOf, () => shape).layers[0]!.d;
    const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    for (let i = 0; i < n.length / 2; i++) {
      const a = (i / (n.length / 2)) * Math.PI * 2;
      const outward = (n[i * 2]! - 50) * Math.cos(a) + (n[i * 2 + 1]! - 50) * Math.sin(a);
      expect(outward).toBeGreaterThan(5);
    }
  });

  it('draws a steady pad jagged all the way round, not as a smooth circle', () => {
    const pad = ring(Array.from({ length: 32 }, () => [0.3, -0.3]));
    const r = radii(riffSplat(riff([['bass', 1]]), docOf, () => pad).layers[0]!.d);
    const spread = Math.max(...r) - Math.min(...r);
    expect(spread).toBeGreaterThan(10);
  });

  it('shows where a stem is loud and where it is quiet', () => {
    // A hit at the top of the loop, near-silence after it.
    const hit = ring([[1, -1], ...Array.from({ length: 15 }, (): [number, number] => [0.05, -0.05])]);
    const r = radii(riffSplat(riff([['bass', 1]]), docOf, () => hit).layers[0]!.d);
    const reach = (i: number) => Math.abs(r[i * 2]! - r[i * 2 + 1]!);
    expect(reach(0)).toBeGreaterThan(reach(8) * 5);
  });

  it('keeps the seeded shape for a stem whose audio isn’t decoded yet', () => {
    const seeded = riffSplat(riff([['bass', 1]]), docOf);
    const waiting = riffSplat(riff([['bass', 1]]), docOf, () => undefined);
    expect(waiting.layers[0]!.d).toBe(seeded.layers[0]!.d);
  });

  it('keeps the seeded shape for a silent stem, rather than a dot', () => {
    const seeded = riffSplat(riff([['bass', 1]]), docOf);
    const silent = riffSplat(riff([['bass', 1]]), docOf, () => new Float32Array(32));
    expect(silent.layers[0]!.d).toBe(seeded.layers[0]!.d);
  });

  it('still stays inside its 100×100 box', () => {
    const loud = Float32Array.from({ length: 512 }, (_, i) => (i % 2 ? -1 : 1));
    const splat = riffSplat(
      riff(Array.from({ length: 8 }, (_, i) => [`s${i}`, 1] as [string, number])),
      () => doc('ffffffff'),
      () => loud,
    );
    const coords = splat.layers.flatMap((l) => l.d.match(/-?\d+(\.\d+)?/g)!.map(Number));
    expect(Math.min(...coords)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...coords)).toBeLessThanOrEqual(100);
  });
});
