/**
 * Piecewise-linear timeline scale.
 *
 * Fourteen centuries do not fit evenly on one slider: the pre-1613 period is
 * compressed and the 1791–1800 chapter is expanded so that individual
 * months of 1798 can be selected.
 */
export interface ScaleSegment {
  /** Year range [from, to]. */
  years: [number, number];
  /** Slider position range [from, to] in 0..1. */
  pos: [number, number];
}

export const TIMELINE_SEGMENTS: readonly ScaleSegment[] = [
  { years: [600, 1613], pos: [0, 0.07] },
  { years: [1613, 1791], pos: [0.07, 0.27] },
  { years: [1791, 1801], pos: [0.27, 0.4] },
  { years: [1801, 1900], pos: [0.4, 0.63] },
  { years: [1900, 1945], pos: [0.63, 0.78] },
  { years: [1945, 2026.99], pos: [0.78, 1] },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Map a decimal year to a slider position in [0, 1]. */
export function yearToPosition(year: number, segments: readonly ScaleSegment[] = TIMELINE_SEGMENTS): number {
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first || !last) throw new Error("Timeline scale has no segments");
  if (year <= first.years[0]) return first.pos[0];
  if (year >= last.years[1]) return last.pos[1];
  for (const seg of segments) {
    const [y0, y1] = seg.years;
    if (year >= y0 && year <= y1) {
      const t = (year - y0) / (y1 - y0);
      return seg.pos[0] + t * (seg.pos[1] - seg.pos[0]);
    }
  }
  return last.pos[1];
}

/** Inverse of {@link yearToPosition}. */
export function positionToYear(position: number, segments: readonly ScaleSegment[] = TIMELINE_SEGMENTS): number {
  const p = clamp(position, 0, 1);
  for (const seg of segments) {
    const [p0, p1] = seg.pos;
    if (p >= p0 && p <= p1) {
      const t = p1 === p0 ? 0 : (p - p0) / (p1 - p0);
      return seg.years[0] + t * (seg.years[1] - seg.years[0]);
    }
  }
  const last = segments[segments.length - 1];
  return last ? last.years[1] : 0;
}

/**
 * Playback speed in years per second, adapted to the density of the
 * timeline so the 1790s are not crossed in an instant.
 */
export function playbackRate(year: number, multiplier: number): number {
  let base: number;
  if (year < 1613) base = 60;
  else if (year >= 1791 && year < 1801) base = 0.6;
  else if (year < 1791) base = 6;
  else base = 4;
  return base * multiplier;
}

/** Major tick years for the timeline axis. */
export const AXIS_TICKS: readonly number[] = [
  600, 1200, 1613, 1650, 1700, 1750, 1791, 1795, 1798, 1801, 1850, 1900, 1921, 1945, 1969, 1998, 2026,
];

/** Snap a year to a sensible granularity for display while scrubbing. */
export function snapYear(year: number): number {
  if (year >= 1791 && year < 1801) return Math.round(year * 12) / 12; // monthly in the 1790s
  if (year < 1613) return Math.round(year / 10) * 10;
  return Math.round(year * 4) / 4;
}
