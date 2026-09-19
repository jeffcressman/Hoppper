import { hash, SPECTRUM } from './hash';

// Endlesss jam profiles carry no cover image, so each jam gets a generated
// one: two colours from the design system's spectrum, picked by the jam ID so
// a jam always looks the same.

const ANGLES = [110, 120, 135, 150, 160];

export function jamCover(jamId: string): string {
  const h = hash(jamId);
  const first = h % SPECTRUM.length;
  // An offset of 1..n-1 keeps the second colour different from the first.
  const second = (first + 1 + (Math.floor(h / SPECTRUM.length) % (SPECTRUM.length - 1))) % SPECTRUM.length;
  const angle = ANGLES[Math.floor(h / 81) % ANGLES.length];
  return `linear-gradient(${angle}deg, var(--spectrum-${SPECTRUM[first]}), var(--spectrum-${SPECTRUM[second]}))`;
}
