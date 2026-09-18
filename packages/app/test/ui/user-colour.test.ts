import { describe, it, expect } from 'vitest';
import { userColour } from '../../src/ui/user-colour';

describe('userColour', () => {
  it('gives a user the same colour everywhere', () => {
    expect(userColour('lwlkc')).toBe(userColour('lwlkc'));
  });

  it('is a spectrum colour from the design system', () => {
    expect(userColour('jrc1')).toMatch(/^var\(--spectrum-[a-z]+\)$/);
  });

  it('spreads users across the spectrum', () => {
    const colours = new Set(['lwlkc', 'jrc1', 'villan', 'mng', 'hader', 'rebela', 'jimmy', 'tb'].map(userColour));
    expect(colours.size).toBeGreaterThanOrEqual(4);
  });
});
