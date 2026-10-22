/** Design palette (from the brief) and derived map colours. */
export const PALETTE = {
  navy: "#071923",
  emerald: "#063D3B",
  teal: "#0A333C",
  cyan: "#49EAD8",
  amber: "#E8B76B",
  cream: "#F2E8D5",
} as const;

export type Rgba = [number, number, number, number];

export function hexToRgba(hex: string, alpha = 1): Rgba {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

/** Massing colours live in layerStyles.ts (configurable by the viewer). */

/** Evidence colours for event markers. */
export const CONFIDENCE_COLOURS = {
  documented: PALETTE.cyan,
  probable: "#8fd3c7",
  approximate: "#d8c38b",
  tradition: PALETTE.amber,
} as const;

export const CONFIDENCE_LABELS = {
  documented: "Documented",
  probable: "Probable",
  approximate: "Approximate location",
  tradition: "Reported tradition",
} as const;
