/**
 * A new take's name: "20260919 Sunday drift hoppp" — the day its first rifff
 * was committed (local time), the jam, and "hoppp". The date is the rifff's,
 * not the recording's, so the hop can be found again in Endlesss or LORE
 * (the user's format, 2026-09-18). Exports are named the same.
 */
export function hopName(firstRiffCreatedAtMs: number, jamName: string): string {
  const d = new Date(firstRiffCreatedAtMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return `${day} ${jamName.trim() || 'jam'} hoppp`;
}
