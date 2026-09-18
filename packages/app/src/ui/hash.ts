/** FNV-1a: a small, stable string hash for picking colours and shapes by ID. */
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A seeded 0..1 random stream, so a shape drawn from an ID is the same every time. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const SPECTRUM = [
  'amber',
  'yellow',
  'green',
  'teal',
  'blue',
  'indigo',
  'violet',
  'pink',
  'red',
] as const;
