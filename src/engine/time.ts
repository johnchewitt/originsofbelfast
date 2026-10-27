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
 * Feature cap for the massing layer view. Every block is loaded once and
 * time is applied with a layer-view filter, so the whole layer must fit
 * under this cap (a test checks the built data).
 */
export const MASSING_FEATURE_CAP = 12500;

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

/** Round down to a multiple of `step` (stable string output for where clauses). */
export function quantize(year: number, step: number): number {
  return Math.round(Math.floor(year / step + 1e-9) * step * 1000) / 1000;
}

/**
 * Year to embed in a year-dependent renderer so that it is rebuilt only when
 * its output would change. Inside an "active" interval (a construction period,
 * during which heights change continuously) the year is used as is; elsewhere
 * it snaps to the latest date in `breaks`, because between consecutive dates
 * every feature renders identically (unit-tested). Rebuilding a renderer makes
 * the layer re-symbolise every feature, which shows as a flicker.
 */
export function stableRendererYear(
  year: number,
  breaks: readonly number[] | undefined,
  active: readonly (readonly [number, number])[] = [],
): number {
  if (!breaks || breaks.length === 0) return year;
  for (const [a, b] of active) if (year > a && year < b) return year;
  return snapToBreakpoint(year, breaks as number[]);
}

/** Years a street glows as "new" after it first appears (street renderer). */
export const NEW_STREET_YEARS = 10;

/**
 * Dates at which a year-dependent renderer's output changes, for
 * {@link stableRendererYear}. Landmark heights change continuously during
 * construction ([build_start, start_year]) and are constant otherwise; a
 * street's class changes when it appears and when it stops being "new".
 */
export function rendererBreaksFor(
  id: "landmarks" | "streets",
  features: readonly { properties: Record<string, unknown> }[],
): { breaks: number[]; active: [number, number][] } {
  const breaks = new Set<number>();
  const active: [number, number][] = [];
  for (const f of features) {
    const p = f.properties;
    if (id === "landmarks") {
      const a = Number(p.build_start);
      const b = Number(p.start_year);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      breaks.add(a);
      breaks.add(b);
      if (b > a) active.push([a, b]);
    } else {
      const start = Number(p.start_year);
      if (!Number.isFinite(start)) continue;
      breaks.add(start);
      breaks.add(Math.round((start + NEW_STREET_YEARS) * 1000) / 1000);
    }
  }
  return { breaks: [...breaks].sort((x, y) => x - y), active };
}

/**
 * The latest date in `breakpoints` that is not after `year`. Filtering with
 * `start <= t AND end > t` gives the same features for t and for `year`
 * whenever no start or end date lies between them — so the filter string only
 * changes when the visible set does.
 */
export function snapToBreakpoint(year: number, breakpoints: number[] | undefined): number {
  if (!breakpoints || breakpoints.length === 0) return year;
  let lo = 0;
  let hi = breakpoints.length - 1;
  // Before the first date nothing has started: any value below it gives the same (empty) set.
  if ((breakpoints[0] as number) > year) return (breakpoints[0] as number) - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((breakpoints[mid] as number) <= year) lo = mid;
    else hi = mid - 1;
  }
  return breakpoints[lo] as number;
}
