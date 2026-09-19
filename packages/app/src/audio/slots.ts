import type { ResolvedStem, RiffDocument } from '@hoppper/sdk';

export const SLOT_COUNT = 8;

export interface PlacedStem {
  stem: ResolvedStem;
  /** The rifff's gain for this slot (LORE's `m_stemGains`). */
  gain: number;
}

/**
 * Put each resolved stem back in its rifff slot. The mixer works per slot, so
 * a stem has to keep its slot through the stem resolver, which hands back only
 * the stems it could resolve, in slot order.
 */
export function placeStems(
  riff: RiffDocument,
  stems: ReadonlyArray<ResolvedStem>,
): (PlacedStem | null)[] {
  const placed: (PlacedStem | null)[] = Array(SLOT_COUNT).fill(null);
  const unused = [...stems];
  riff.slots.slice(0, SLOT_COUNT).forEach((slot, i) => {
    if (!slot.on || !slot.stemId) return;
    const at = unused.findIndex((s) => s.stemId === slot.stemId);
    if (at === -1) return;
    const [stem] = unused.splice(at, 1);
    placed[i] = { stem: stem!, gain: slot.gain };
  });
  // Anything the rifff doesn't list still plays, in the first free slot.
  for (const stem of unused) {
    const free = placed.indexOf(null);
    if (free === -1) break;
    placed[free] = { stem, gain: 1 };
  }
  return placed;
}
