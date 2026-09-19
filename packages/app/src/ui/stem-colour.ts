/**
 * A stem document's `primaryColour` as a CSS colour, or null if it can't be
 * read. Endlesss writes eight hex digits, alpha first (AARRGGBB) — LORE's
 * ParseHexColour, r2.ouro/app/imgui.ext.cpp.
 */
export function stemColour(raw: string): string | null {
  if (!/^[0-9a-f]{8}$/i.test(raw)) return null;
  const byte = (i: number) => parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  const [a, r, g, b] = [byte(0), byte(1), byte(2), byte(3)];
  return a === 255 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${(a / 255).toFixed(3)})`;
}
