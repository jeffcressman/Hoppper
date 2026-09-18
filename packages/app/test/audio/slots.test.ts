import { describe, it, expect } from 'vitest';
import type { ResolvedStem, RiffDocument, RiffSlot, StemCouchID } from '@hoppper/sdk';
import { placeStems } from '../../src/audio/slots';

const stem = (id: string) => ({ stemId: id as StemCouchID }) as ResolvedStem;
const on = (id: string, gain = 1): RiffSlot => ({ on: true, stemId: id as StemCouchID, gain });
const off: RiffSlot = { on: false, stemId: null, gain: 0 };
const riff = (slots: RiffSlot[]) =>
  ({ slots: [...slots, ...Array(8 - slots.length).fill(off)] }) as RiffDocument;

describe('placeStems', () => {
  it('puts each stem in the slot the rifff has it in, with that slot’s gain', () => {
    const placed = placeStems(riff([on('a', 0.5), off, on('b', 0.8)]), [stem('a'), stem('b')]);
    expect(placed.map((p) => p && [p.stem.stemId, p.gain])).toEqual([
      ['a', 0.5], null, ['b', 0.8], null, null, null, null, null,
    ]);
  });

  it('keeps a stem the rifff uses twice in both its slots', () => {
    const placed = placeStems(riff([on('a', 1), on('a', 0.3)]), [stem('a'), stem('a')]);
    expect(placed.slice(0, 2).map((p) => p?.gain)).toEqual([1, 0.3]);
  });

  it('leaves a slot empty when its stem couldn’t be resolved', () => {
    const placed = placeStems(riff([on('a'), on('gone'), on('b')]), [stem('a'), stem('b')]);
    expect(placed.slice(0, 3).map((p) => p?.stem.stemId ?? null)).toEqual(['a', null, 'b']);
  });

  it('puts a stem the rifff doesn’t list in the next free slot at full gain', () => {
    const placed = placeStems(riff([on('a', 0.5)]), [stem('a'), stem('stray')]);
    expect(placed.slice(0, 2).map((p) => p && [p.stem.stemId, p.gain])).toEqual([
      ['a', 0.5],
      ['stray', 1],
    ]);
  });

  it('always gives eight slots', () => {
    expect(placeStems({ slots: [] } as unknown as RiffDocument, [])).toHaveLength(8);
  });
});
