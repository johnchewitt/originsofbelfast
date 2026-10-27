import { describe, expect, it } from "vitest";
import {
  PRESENT_SENTINEL,
  constructionProgress,
  effectiveBuildStart,
  eventFade,
  eventsStartingBetween,
  heightArcade,
  isComplete,
  isEventVisible,
  isPresent,
  NEW_STREET_YEARS,
  presentWhereClause,
  quantize,
  rampByYear,
  rendererBreaksFor,
  snapToBreakpoint,
  stableRendererYear,
} from "./time";
import type { TemporalProps } from "../types/history";

const marketHouse: TemporalProps = { build_start: 1638, start_year: 1639, end_year: 1810 };
const cityHall: TemporalProps = { build_start: 1898, start_year: 1906.58, end_year: null };
const noBuildDate: TemporalProps = { build_start: null, start_year: 1869, end_year: null };

/** Minimal evaluator for the where clauses produced by presentWhereClause. */
function evaluateWhere(clause: string, attrs: Record<string, number>): boolean {
  const parts = [...clause.matchAll(/\((\w+) (<=|>) ([\d.]+)\)/g)];
  expect(parts.length).toBe(2);
  return parts.every(([, field, op, value]) => {
    const a = attrs[field as string] as number;
    const v = Number(value);
    return op === "<=" ? a <= v : a > v;
  });
}

describe("isPresent / isComplete — building intervals", () => {
  it("is absent before construction starts", () => {
    expect(isPresent(marketHouse, 1637.9)).toBe(false);
  });
  it("is present but incomplete during construction", () => {
    expect(isPresent(marketHouse, 1638.5)).toBe(true);
    expect(isComplete(marketHouse, 1638.5)).toBe(false);
  });
  it("is present at the 1798 execution", () => {
    expect(isPresent(marketHouse, 1798.54)).toBe(true);
    expect(isComplete(marketHouse, 1798.54)).toBe(true);
  });
  it("is absent from the demolition year onward (half-open interval)", () => {
    expect(isPresent(marketHouse, 1810)).toBe(false);
    expect(isPresent(marketHouse, 1809.999)).toBe(true);
  });
  it("treats a null end year as still standing", () => {
    expect(isPresent(cityHall, 2026.9)).toBe(true);
  });
  it("assumes a default construction period when build_start is missing", () => {
    expect(effectiveBuildStart(noBuildDate)).toBeCloseTo(1867.5);
    expect(isPresent(noBuildDate, 1868)).toBe(true);
    expect(isComplete(noBuildDate, 1868)).toBe(false);
  });
});

describe("constructionProgress — growth animation", () => {
  it("is 0 before, 1 after and linear during construction", () => {
    expect(constructionProgress(cityHall, 1897)).toBe(0);
    expect(constructionProgress(cityHall, 1906.58)).toBe(1);
    expect(constructionProgress(cityHall, 2000)).toBe(1);
    expect(constructionProgress(cityHall, 1902.29)).toBeCloseTo(0.5, 2);
  });
  it("never divides by zero for instantaneous features", () => {
    expect(constructionProgress({ build_start: 1900, start_year: 1900, end_year: null }, 1900)).toBe(1);
  });
});

describe("presentWhereClause — agrees with isPresent", () => {
  const features = [marketHouse, cityHall, noBuildDate];
  const years = [1500, 1638, 1638.5, 1639, 1798.54, 1809.99, 1810, 1868, 1898, 1906, 2026];
  for (const year of years) {
    it(`matches the TypeScript predicate at ${year}`, () => {
      const clause = presentWhereClause(year);
      for (const f of features) {
        const attrs = { build_start: effectiveBuildStart(f), end_year: f.end_year ?? PRESENT_SENTINEL };
        expect(evaluateWhere(clause, attrs)).toBe(isPresent(f, year));
      }
    });
  }
  it("supports custom field names for compact layers", () => {
    expect(presentWhereClause(1791.5, "b", "e")).toBe("(b <= 1791.5) AND (e > 1791.5)");
  });
});

describe("heightArcade", () => {
  it("embeds the year and field names", () => {
    const expr = heightArcade(1798.54, { build: "b", start: "s", height: "h" });
    expect(expr).toContain("var y = 1798.54;");
    expect(expr).toContain("$feature.b");
    expect(expr).toContain("$feature.h");
  });
  it("handles raised parts when a base field is given", () => {
    expect(heightArcade(1900, { build: "build_start", start: "start_year", height: "height_m", base: "base_m" })).toContain("$feature.base_m > 0");
  });
});

describe("event visibility", () => {
  const execution = { start_year: 1798.54, end_year: 1798.54, timeline_importance: 5 as const, chapter: "1798" as const };
  const minor = { start_year: 1850, end_year: 1850, timeline_importance: 1 as const, chapter: null };
  it("appears at its date and persists according to importance", () => {
    expect(isEventVisible(execution, 1798.5)).toBe(false);
    expect(isEventVisible(execution, 1798.6)).toBe(true);
    expect(isEventVisible(execution, 1840)).toBe(true);
    expect(isEventVisible(execution, 1850)).toBe(false);
    expect(isEventVisible(minor, 1855)).toBe(true);
    expect(isEventVisible(minor, 1857)).toBe(false);
  });
  it("keeps all chapter events visible in story mode", () => {
    expect(isEventVisible(execution, 1700, { chapter: "1798" })).toBe(true);
    expect(isEventVisible(minor, 1700, { chapter: "1798" })).toBe(false);
  });
  it("fades out towards the end of persistence", () => {
    expect(eventFade(minor, 1849)).toBe(0);
    expect(eventFade(minor, 1850)).toBe(1);
    expect(eventFade(minor, 1853)).toBeCloseTo(0.5);
  });
  it("finds events starting within a playback step", () => {
    const list = [execution, minor];
    expect(eventsStartingBetween(list, 1798, 1799)).toEqual([execution]);
    expect(eventsStartingBetween(list, 1799, 1798)).toEqual([execution]);
    expect(eventsStartingBetween(list, 1798.54, 1800)).toEqual([]);
  });
});

describe("rampByYear", () => {
  it("clamps and interpolates", () => {
    expect(rampByYear(1980, [1986, 2008], 0.3, 1)).toBe(0.3);
    expect(rampByYear(1997, [1986, 2008], 0, 1)).toBeCloseTo(0.5);
    expect(rampByYear(2020, [1986, 2008], 0.3, 1)).toBe(1);
  });
});

describe("filter stability during playback", () => {
  it("quantizes years down to a step with stable decimals", () => {
    expect(quantize(1798.54, 0.25)).toBe(1798.5);
    expect(quantize(1798.75, 0.25)).toBe(1798.75);
    expect(quantize(1850.99, 1)).toBe(1850);
    expect(quantize(1612.4, 5)).toBe(1610);
  });

  it("snaps to the latest date not after the year", () => {
    const dates = [1613, 1639, 1810, PRESENT_SENTINEL];
    expect(snapToBreakpoint(1700, dates)).toBe(1639);
    expect(snapToBreakpoint(1639, dates)).toBe(1639);
    expect(snapToBreakpoint(2026, dates)).toBe(1810);
    expect(snapToBreakpoint(1500, dates)).toBe(1612);
    expect(snapToBreakpoint(1700, undefined)).toBe(1700);
  });

  it("shows exactly the same features at the snapped year as at the real year", () => {
    // Deterministic pseudo-random intervals, including open-ended ones.
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const features = Array.from({ length: 300 }, () => {
      const start = Math.round((1600 + rand() * 420) * 100) / 100;
      const end = rand() < 0.4 ? PRESENT_SENTINEL : Math.round((start + rand() * 150) * 100) / 100;
      return { start, end };
    });
    const dates = [...new Set(features.flatMap((f) => [f.start, f.end]))].sort((a, b) => a - b);
    const visibleIds = (t: number) => features.map((f, i) => (f.start <= t && f.end > t ? i : -1)).filter((i) => i >= 0).join();
    for (let y = 1550; y <= 2030; y += 0.37) {
      expect(visibleIds(snapToBreakpoint(y, dates))).toBe(visibleIds(y));
    }
  });
});

/** TypeScript replica of the Arcade in heightArcade (landmark renderer). */
function arcadeHeight(year: number, f: { build_start: number; start_year: number; height_m: number; base_m: number }): number {
  const { build_start: s, start_year: e, height_m: h, base_m: base } = f;
  const p = e <= s ? 1 : Math.min(1, Math.max(0, (year - s) / (e - s)));
  if (base > 0) return p < 0.85 ? 0.05 : h * Math.max(0.05, (p - 0.85) / 0.15);
  return Math.max(0.05, h * p);
}

describe("stableRendererYear — rebuild year-dependent renderers only when they change", () => {
  let seed = 11;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const landmarks = Array.from({ length: 60 }, () => {
    const build = Math.round((1600 + rand() * 400) * 100) / 100;
    return { properties: { build_start: build, start_year: Math.round((build + rand() * 8) * 100) / 100, height_m: 10 + rand() * 40, base_m: rand() < 0.2 ? 20 : 0 } };
  });
  const streets = Array.from({ length: 200 }, () => ({ properties: { start_year: Math.round((1600 + rand() * 420) * 100) / 100 } }));

  it("gives every landmark exactly the same height as the real year would", () => {
    const { breaks, active } = rendererBreaksFor("landmarks", landmarks);
    for (let y = 1550; y <= 2030; y += 0.25) {
      const stable = stableRendererYear(y, breaks, active);
      for (const { properties: f } of landmarks) expect(arcadeHeight(stable, f)).toBe(arcadeHeight(y, f));
    }
  });
  it("gives every street exactly the same 'new' class as the real year would", () => {
    const { breaks } = rendererBreaksFor("streets", streets);
    for (let y = 1600; y <= 2030; y += 0.5) {
      const stable = stableRendererYear(y, breaks);
      for (const { properties: f } of streets) {
        if (f.start_year > y) continue; // not on the map (time filter)
        expect(stable - f.start_year < NEW_STREET_YEARS).toBe(y - f.start_year < NEW_STREET_YEARS);
      }
    }
  });
  it("rebuilds the landmark renderer far less often than every quarter-year", () => {
    // Realistic density: 34 landmarks, each under construction for 0.5–3 years.
    const sparse = Array.from({ length: 34 }, () => {
      const build = Math.round((1600 + rand() * 420) * 100) / 100;
      return { properties: { build_start: build, start_year: Math.round((build + 0.5 + rand() * 2.5) * 100) / 100 } };
    });
    const { breaks, active } = rendererBreaksFor("landmarks", sparse);
    const years = Array.from({ length: (2026 - 1600) * 4 + 1 }, (_, i) => 1600 + i / 4);
    const before = new Set(years.map((y) => quantize(y, 0.25))).size;
    const after = new Set(years.map((y) => stableRendererYear(quantize(y, 0.25), breaks, active))).size;
    expect(after).toBeLessThan(before / 3);
  });
  it("passes the year straight through when no dates are known yet", () => {
    expect(stableRendererYear(1850.25, undefined)).toBe(1850.25);
    expect(stableRendererYear(1850.25, [])).toBe(1850.25);
  });
});

