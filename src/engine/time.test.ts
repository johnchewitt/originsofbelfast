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
  presentWhereClause,
  rampByYear,
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
