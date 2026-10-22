/**
 * Time engine: which historic geometry exists at a given decimal year, and
 * how far through construction it is.
 *
 * The same rules are expressed twice — as TypeScript predicates (used for
 * lists, statistics and tests) and as SQL-92 where clauses / Arcade
 * expressions applied to ArcGIS layers — and the unit tests check that the
 * two agree.
 */
import type { TemporalProps, HistoricalEvent } from "../types/history";

/**
 * Most massing features the 3D view is asked to draw at once. The data build
 * must keep the peak concurrent count below this (a test checks it).
 */
export const MASSING_FEATURE_CAP = 9000;

/** Sentinel stored in layer attributes for "still standing". */
export const PRESENT_SENTINEL = 9999;

/** Default construction period when a source gives only a completion date. */
export const DEFAULT_BUILD_YEARS = 1.5;

/** Years an event marker stays on the map after its end, by importance. */
export const EVENT_PERSISTENCE: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 6,
  2: 10,
  3: 18,
  4: 30,
  5: 45,
};

export function effectiveBuildStart(f: TemporalProps): number {
  return f.build_start ?? f.start_year - DEFAULT_BUILD_YEARS;
}

export function effectiveEnd(f: TemporalProps): number {
  return f.end_year ?? PRESENT_SENTINEL;
}

/**
 * True when the feature exists (under construction or complete) at `year`.
 * Interval is [build_start, end_year): a building demolished in 1810 is
 * absent in 1810.0.
 */
export function isPresent(f: TemporalProps, year: number): boolean {
  return effectiveBuildStart(f) <= year && year < effectiveEnd(f);
}

/** True when the feature is complete and still standing at `year`. */
export function isComplete(f: TemporalProps, year: number): boolean {
  return f.start_year <= year && year < effectiveEnd(f);
}

/**
 * Fraction of construction completed at `year`, clamped to [0, 1].
 * Returns 0 before construction and 1 once complete.
 */
export function constructionProgress(f: TemporalProps, year: number): number {
  const start = effectiveBuildStart(f);
  const end = f.start_year;
  if (year >= end || end <= start) return year >= end ? 1 : 0;
  if (year <= start) return 0;
  return (year - start) / (end - start);
}

/** Round a year for use in generated SQL/Arcade (avoids float noise). */
export function sqlYear(year: number): string {
  return (Math.round(year * 1000) / 1000).toString();
}

/**
 * Where clause equivalent to {@link isPresent} for layers whose attributes
 * use numeric fields (end = PRESENT_SENTINEL for standing features).
 */
export function presentWhereClause(year: number, buildField = "build_start", endField = "end_year"): string {
  const y = sqlYear(year);
  return `(${buildField} <= ${y}) AND (${endField} > ${y})`;
}

/**
 * Arcade expression returning the extrusion height for a feature at `year`.
 * Parts with a base above ground (spires, domes, gantry beams) only appear
 * in the last 15% of construction so they never float unsupported.
 */
export function heightArcade(
  year: number,
  fields: { build: string; start: string; height: string; base?: string },
): string {
  const y = sqlYear(year);
  const base = fields.base ? `$feature.${fields.base}` : "0";
  return [
    `var y = ${y};`,
    `var s = $feature.${fields.build};`,
    `var e = $feature.${fields.start};`,
    `var h = $feature.${fields.height};`,
    `var p = IIf(e <= s, 1, Min(1, Max(0, (y - s) / (e - s))));`,
    `if (${base} > 0) { return IIf(p < 0.85, 0.05, h * Max(0.05, (p - 0.85) / 0.15)); }`,
    `return Max(0.05, h * p);`,
  ].join("\n");
}

/** Linear ramp of a value between two years (clamped). */
export function rampByYear(year: number, range: [number, number], from: number, to: number): number {
  const [a, b] = range;
  if (year <= a) return from;
  if (year >= b) return to;
  return from + ((year - a) / (b - a)) * (to - from);
}

export interface EventVisibilityOptions {
  /** In story mode, all events of the active chapter stay visible. */
  chapter?: string | null;
  /** Show events up to this many years before they happen (default 0). */
  lead?: number;
}

/**
 * Whether an event marker should be on the map at `year`. Markers appear at
 * the event's start and persist for a period that grows with importance.
 */
export function isEventVisible(
  event: Pick<HistoricalEvent, "start_year" | "end_year" | "timeline_importance" | "chapter">,
  year: number,
  options: EventVisibilityOptions = {},
): boolean {
  if (options.chapter && event.chapter === options.chapter) return true;
  const lead = options.lead ?? 0;
  const persistence = EVENT_PERSISTENCE[event.timeline_importance] ?? 10;
  return event.start_year - lead <= year && year <= event.end_year + persistence;
}

/** Fade factor 0..1 for event markers near the end of their persistence. */
export function eventFade(
  event: Pick<HistoricalEvent, "start_year" | "end_year" | "timeline_importance">,
  year: number,
): number {
  const persistence = EVENT_PERSISTENCE[event.timeline_importance] ?? 10;
  if (year < event.start_year) return 0;
  if (year <= event.end_year) return 1;
  const elapsed = year - event.end_year;
  return Math.max(0, 1 - elapsed / persistence);
}

/** Events whose start lies in (from, to] — used to announce new events during playback. */
export function eventsStartingBetween<T extends Pick<HistoricalEvent, "start_year">>(
  events: readonly T[],
  from: number,
  to: number,
): T[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return events.filter((e) => e.start_year > lo && e.start_year <= hi);
}
