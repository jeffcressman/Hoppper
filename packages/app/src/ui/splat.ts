import type { RiffDocument, StemCouchID, StemDocument } from '@hoppper/sdk';
import { hash, seededRandom } from './hash';
import { stemColour } from './stem-colour';

// A rifff drawn the way Endlesss's rifff visualiser draws it, seen from above:
// one spiky layer per stem, in the stem's own colour
// (`project resources/Design/Rifff visualiser example.png`). The spikes are
// seeded by the stem ID for now, so a stem looks the same wherever it's
// reused; drawing them from the stem's audio can come once waveform peaks
// exist (Slice B).

export interface SplatLayer {
  /** SVG path in a 100×100 box. */
  d: string;
  colour: string;
}

export interface Splat {
  /** Bottom first. */
  layers: SplatLayer[];
  /** Some stem documents haven't arrived yet; colours will follow. */
  pending: boolean;
}

const POINTS = 40;
const MISSING = 'var(--text-4)';
const WAITING = 'var(--surface-3)';

function layerPath(stemId: string, radius: number): string {
  const r = seededRandom(hash(stemId));
  const p1 = r() * Math.PI * 2;
  const p2 = r() * Math.PI * 2;
  let d = '';
  for (let i = 0; i < POINTS; i++) {
    const a = (i / POINTS) * Math.PI * 2;
    // Every other point reaches out further: the spikes.
    const spike = i % 2 ? r() * 0.34 : r() * 0.1;
    const rad = radius * (0.64 + 0.13 * Math.sin(3 * a + p1) + 0.08 * Math.sin(5 * a + p2) + spike);
    d += `${i ? 'L' : 'M'}${(50 + rad * Math.cos(a)).toFixed(1)} ${(50 + rad * Math.sin(a)).toFixed(1)}`;
  }
  return `${d}Z`;
}

export function riffSplat(
  riff: RiffDocument,
  docOf: (id: StemCouchID) => StemDocument | null | undefined,
): Splat {
  const playing = riff.slots
    .map((slot, index) => ({ ...slot, index }))
    .filter((s): s is typeof s & { stemId: StemCouchID } => s.on && !!s.stemId)
    // Loudest first — it goes underneath. Ties keep slot order.
    .sort((a, b) => b.gain - a.gain || a.index - b.index);

  // A fuller rifff makes a bigger splat. At most 40, and the spikes reach
  // 1.19× their radius, so every layer stays inside the 100×100 box.
  const base = 26 + 14 * (playing.length / 8);
  let pending = false;
  const layers = playing.map((slot, rank) => {
    const doc = docOf(slot.stemId);
    if (doc === undefined) pending = true;
    const colour =
      doc === undefined ? WAITING : doc === null ? MISSING : stemColour(doc.primaryColour) ?? MISSING;
    return { d: layerPath(slot.stemId, base * (1 - rank * 0.1)), colour };
  });
  return { layers, pending };
}
