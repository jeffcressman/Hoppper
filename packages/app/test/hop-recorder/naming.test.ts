import { describe, it, expect } from 'vitest';
import { hopName } from '../../src/hop-recorder/naming';

describe('hopName — how a new take is named', () => {
  it('is "<YYYYMMDD of its first rifff> <jam> hoppp"', () => {
    const firstRifff = new Date(2026, 8, 19, 21, 40).getTime();
    expect(hopName(firstRifff, 'Sunday drift')).toBe('20260919 Sunday drift hoppp');
  });

  it('dates it by when the first rifff was committed, in local time, zero-padded', () => {
    expect(hopName(new Date(2026, 0, 8, 9, 5).getTime(), 'Low End')).toBe('20260108 Low End hoppp');
  });

  it('falls back to "jam" for a jam with no name', () => {
    expect(hopName(new Date(2026, 0, 8).getTime(), '  ')).toBe('20260108 jam hoppp');
  });
});
