import { describe, it, expect } from 'vitest';
import { jamCover } from '../../src/ui/jam-cover';

describe('jamCover', () => {
  it('gives a jam the same cover every time', () => {
    expect(jamCover('band1')).toBe(jamCover('band1'));
  });

  it('draws two spectrum colours from the design system', () => {
    expect(jamCover('band1')).toMatch(
      /^linear-gradient\(\d+deg, var\(--spectrum-[a-z]+\), var\(--spectrum-[a-z]+\)\)$/,
    );
  });

  it('never blends a colour into itself', () => {
    for (const id of ['a', 'b', 'band1', 'bande7b989f1bb', 'lwlkc', 'x'.repeat(40)]) {
      const [, a, b] = jamCover(id).match(/--spectrum-([a-z]+).*--spectrum-([a-z]+)/)!;
      expect(a).not.toBe(b);
    }
  });

  it('tells different jams apart', () => {
    const covers = new Set(Array.from({ length: 30 }, (_, i) => jamCover(`band${i}`)));
    expect(covers.size).toBeGreaterThan(20);
  });
});
