import { describe, it, expect } from 'vitest';
import { stemColour } from '../../src/ui/stem-colour';

// Endlesss writes a stem's colour as eight hex digits, alpha first: LORE's
// ParseHexColour (r2.ouro/app/imgui.ext.cpp) reads them as A, R, G, B.
describe('stemColour', () => {
  it('reads an opaque AARRGGBB colour as its RGB', () => {
    expect(stemColour('ff4d9de0')).toBe('rgb(77 157 224)');
  });

  it('keeps a colour’s own transparency', () => {
    expect(stemColour('804d9de0')).toBe('rgb(77 157 224 / 0.502)');
  });

  it('ignores case', () => {
    expect(stemColour('FF4D9DE0')).toBe('rgb(77 157 224)');
  });

  it.each(['', 'ff4d9d', 'zz4d9de0', '#ff4d9de0', 'ff4d9de0ff'])('gives up on %j', (raw) => {
    expect(stemColour(raw)).toBeNull();
  });
});
