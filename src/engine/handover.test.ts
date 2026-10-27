import { describe, expect, it } from "vitest";
import {
  handoverState,
  handoverYear,
  isMassingShown,
  massingWhereClause,
  modernFadeRange,
  phasesOf,
  reconstructionPhase,
  retireRange,
  smoothstep,
  stepValue,
} from "./handover";
import { seededRandom } from "./envelope";

const WINDOW: [number, number] = [1986, 2008];
const AVAILABLE = { modernOpacity: 0.35, modernAvailable: true };

/** Years from `from` to `to` in steps of `step`, without float drift. */
function sweep(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let i = 0; from + i * step <= to + 1e-9; i += 1) out.push(Math.round((from + i * step) * 1000) / 1000);
  return out;
}

/** Evaluates the conjunctions of simple comparisons produced by massingWhereClause. */
function evaluateWhere(clause: string, attrs: Record<string, number>): boolean {
  const parts = [...clause.matchAll(/\((\w+) (<=|>) ([\d.]+)\)/g)];
  expect(parts.length).toBeGreaterThanOrEqual(2);
  return parts.every(([, field, op, value]) => {
    const a = attrs[field as string] as number;
    return op === "<=" ? a <= Number(value) : a > Number(value);
  });
}

/** A synthetic city: handover years drawn exactly as the data build draws them. */
function syntheticBlocks(n = 2000) {
  const rand = seededRandom(42);
  return Array.from({ length: n }, () => ({ b: 1900, e: 9999, r: handoverYear(WINDOW, rand(), rand()) }));
}

describe("handoverState — model, handover, present", () => {
  it("shows the model with ghost outlines before the handover", () => {
    const h = handoverState(1970, WINDOW, AVAILABLE);
    expect(h.phase).toBe("model");
    expect(h.modernMode).toBe("ghost");
    expect(h.modernOpacity).toBe(0.35);
    expect(h.retireBlocks).toBe(false);
    expect(h.massingVisible).toBe(true);
    expect(h.envelopeFactor).toBe(1);
  });
  it("switches the present-day buildings to solid as the handover starts", () => {
    const h = handoverState(1986, WINDOW, AVAILABLE);
    expect(h.phase).toBe("handover");
    expect(h.modernMode).toBe("solid");
    expect(h.retireBlocks).toBe(true);
    expect(h.massingVisible).toBe(true);
  });
  it("stops drawing the massing layer once every block has handed over", () => {
    const h = handoverState(2008, WINDOW, AVAILABLE);
    expect(h.phase).toBe("present");
    expect(h.massingVisible).toBe(false);
    expect(h.modernOpacity).toBe(1);
    expect(h.basemapOpacity).toBe(1);
  });
  it("keeps the whole model on screen when the present-day buildings failed to load", () => {
    for (const year of [1970, 1990, 2000, 2026]) {
      const h = handoverState(year, WINDOW, { modernOpacity: 0.35, modernAvailable: false });
      expect(h.massingVisible).toBe(true);
      expect(h.retireBlocks).toBe(false);
      expect(h.modernMode).toBe("ghost");
      expect(h.envelopeFactor).toBe(1);
    }
  });
  it("respects the viewer's present-day opacity before the handover", () => {
    expect(handoverState(1900, WINDOW, { modernOpacity: 0.8, modernAvailable: true }).modernOpacity).toBe(0.8);
    expect(handoverState(1900, WINDOW, { modernOpacity: 0, modernAvailable: true }).modernOpacity).toBe(0);
  });
});

describe("handover — the city never empties (the 1960–1990 'disappearing buildings' bug)", () => {
  const blocks = syntheticBlocks();
  const remaining = (year: number) => blocks.filter((f) => isMassingShown(f, year, true)).length / blocks.length;

  it("never lets present-day opacity plus remaining blocks fall below a full city", () => {
    for (const year of sweep(WINDOW[0], WINDOW[1], 0.05)) {
      const h = handoverState(year, WINDOW, AVAILABLE);
      expect(h.modernOpacity + remaining(year), `year ${year}`).toBeGreaterThanOrEqual(1);
    }
  });
  it("fades the present-day buildings in before any block steps aside", () => {
    const [, fadeEnd] = modernFadeRange(WINDOW);
    const [retireStart] = retireRange(WINDOW);
    expect(retireStart).toBeLessThan(fadeEnd); // the two overlap, so nothing pops
    expect(Math.min(...blocks.map((f) => f.r))).toBeGreaterThanOrEqual(retireStart);
    expect(handoverState(retireStart, WINDOW, AVAILABLE).modernOpacity).toBeGreaterThanOrEqual(0.5);
  });
  it("moves present-day opacity in small steps (no snap from ghost to solid)", () => {
    let previous = handoverState(WINDOW[0], WINDOW, AVAILABLE).modernOpacity;
    for (const year of sweep(WINDOW[0], 2026, 0.05)) {
      const now = handoverState(year, WINDOW, AVAILABLE).modernOpacity;
      expect(Math.abs(now - previous), `year ${year}`).toBeLessThanOrEqual(0.051);
      previous = now;
    }
  });
});

describe("handover — few layer updates during playback", () => {
  const years = sweep(1900, 2026, 0.05);
  const distinct = (pick: (y: number) => number | boolean | string) => new Set(years.map(pick)).size;
  it("never animates the massing opacity: it is not part of the handover at all", () => {
    expect(Object.keys(handoverState(1997, WINDOW, AVAILABLE))).not.toContain("massingOpacity");
  });
  it("changes each faded value only a handful of times across 126 years", () => {
    expect(distinct((y) => handoverState(y, WINDOW, AVAILABLE).modernOpacity)).toBeLessThanOrEqual(19);
    expect(distinct((y) => handoverState(y, WINDOW, AVAILABLE).basemapOpacity)).toBeLessThanOrEqual(10);
    expect(distinct((y) => handoverState(y, WINDOW, AVAILABLE).envelopeFactor)).toBeLessThanOrEqual(8);
    expect(distinct((y) => handoverState(y, WINDOW, AVAILABLE).massingVisible)).toBe(2);
    expect(distinct((y) => handoverState(y, WINDOW, AVAILABLE).modernMode)).toBe(2);
  });
});

describe("handover years", () => {
  it("fall inside the retirement range and move outward with distance", () => {
    const [a, b] = retireRange(WINDOW);
    for (const share of [0, 0.25, 0.5, 1, 3]) {
      for (const jitter of [0, 0.5, 1]) {
        const r = handoverYear(WINDOW, share, jitter);
        expect(r).toBeGreaterThanOrEqual(a - 1e-9);
        expect(r).toBeLessThanOrEqual(b + 1e-9);
      }
    }
    expect(handoverYear(WINDOW, 0.1, 0.5)).toBeLessThan(handoverYear(WINDOW, 0.9, 0.5));
  });
});

describe("massingWhereClause — agrees with isMassingShown", () => {
  const rand = seededRandom(5);
  const features = Array.from({ length: 400 }, () => {
    const b = Math.round((1700 + rand() * 280) * 100) / 100;
    const e = rand() < 0.5 ? 9999 : Math.round((b + 1 + rand() * 120) * 100) / 100;
    return { b, e, r: handoverYear(WINDOW, rand(), rand()) };
  });
  for (const retire of [false, true]) {
    it(`matches the predicate ${retire ? "with" : "without"} handover years`, () => {
      for (const year of sweep(1700, 2026, 0.73)) {
        const clause = massingWhereClause(year, retire);
        for (const f of features) expect(evaluateWhere(clause, f)).toBe(isMassingShown(f, year, retire));
      }
    });
  }
  it("only mentions the handover field when it is used", () => {
    expect(massingWhereClause(1990.25, false)).toBe("(b <= 1990.25) AND (e > 1990.25)");
    expect(massingWhereClause(1990.25, true)).toBe("(b <= 1990.25) AND (e > 1990.25) AND (r > 1990.25)");
  });
});

describe("reconstructionPhase — words for what the scene shows", () => {
  const phases = { clearance: [1960, 1982] as [number, number], redevelopment: [1960, 1985] as [number, number], handover: WINDOW };
  it("names each phase", () => {
    expect(reconstructionPhase(1900, phases).id).toBe("model");
    expect(reconstructionPhase(1970, phases).label).toBe("Clearance & redevelopment");
    expect(reconstructionPhase(1984, phases).id).toBe("redevelopment");
    expect(reconstructionPhase(1997, phases).label).toBe("Handing over to present-day buildings · 50%");
    expect(reconstructionPhase(2026, phases).id).toBe("present");
  });
  it("says the model stays on screen when the present-day buildings are unavailable", () => {
    expect(reconstructionPhase(1970, phases, { modernAvailable: false }).id).toBe("redevelopment");
    expect(reconstructionPhase(1997, phases, { modernAvailable: false }).id).toBe("model-only");
    expect(reconstructionPhase(2026, phases, { modernAvailable: false }).label).toContain("unavailable");
  });
  it("falls back to the handover window for older data builds", () => {
    const p = phasesOf({ fade_to_modern: WINDOW });
    expect(p.redevelopment).toBeNull();
    expect(reconstructionPhase(1970, p).id).toBe("model");
    expect(reconstructionPhase(1990, p).id).toBe("handover");
  });
});

describe("helpers", () => {
  it("steps values with stable decimals", () => {
    expect(stepValue(0.347, 0.05)).toBe(0.35);
    expect(stepValue(0.97, 0.1)).toBe(1);
    expect(stepValue(0.3 + 0.6, 0.1)).toBe(0.9);
  });
  it("eases smoothly and clamps", () => {
    expect(smoothstep(1980, [1986, 1995])).toBe(0);
    expect(smoothstep(1990.5, [1986, 1995])).toBeCloseTo(0.5);
    expect(smoothstep(2000, [1986, 1995])).toBe(1);
  });
});
