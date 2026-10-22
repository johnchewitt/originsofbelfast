import { describe, expect, it } from "vitest";
import { formatEventSpan, formatHistoricDate, fromDecimalYear, parseHistoricDate, toDecimalYear } from "./dates";
import { AXIS_TICKS, positionToYear, snapYear, yearToPosition } from "./timeline";
import { cameraFromLookAt, circle, corridor, courtyard, distance, offset, pointInPolygon, pointInRing, rectangle, ringArea } from "./geo";
import { envelopeRadius, envelopeRing, envelopeYearAt, isMonotonic, seededRandom, type EnvelopeModel } from "./envelope";
import { DEFAULT_SHAREABLE, decodeState, encodeState } from "./urlState";
import { eraForYear, ERAS } from "../data/eras";

describe("dates", () => {
  it("parses variable-precision dates", () => {
    expect(parseHistoricDate("1798-07-17")).toEqual({ year: 1798, month: 7, day: 17 });
    expect(parseHistoricDate("1613-04")).toEqual({ year: 1613, month: 4, day: null });
    expect(parseHistoricDate("0666")).toEqual({ year: 666, month: null, day: null });
  });
  it("rejects malformed dates", () => {
    expect(() => parseHistoricDate("17/07/1798")).toThrow();
    expect(() => parseHistoricDate("1798-13")).toThrow();
    expect(() => parseHistoricDate("1798-02-30")).toThrow();
  });
  it("converts to decimal years with period edges", () => {
    expect(toDecimalYear("1798")).toBe(1798);
    expect(toDecimalYear("1798", "end")).toBeCloseTo(1798.997, 3);
    expect(toDecimalYear("1798-07-17")).toBeCloseTo(1798 + 197 / 365, 6);
    expect(toDecimalYear("1613-04")).toBeLessThan(toDecimalYear("1613-04", "end"));
  });
  it("round-trips decimal years to calendar dates", () => {
    expect(fromDecimalYear(toDecimalYear("1798-07-17"))).toEqual({ year: 1798, month: 7, day: 17 });
    expect(fromDecimalYear(toDecimalYear("1904-02-29"))).toEqual({ year: 1904, month: 2, day: 29 });
  });
  it("formats according to precision", () => {
    expect(formatHistoricDate("1798-07-17", "day")).toBe("17 July 1798");
    expect(formatHistoricDate("1795", "decade")).toBe("1790s");
    expect(formatHistoricDate("0666", "year")).toBe("AD 666");
    expect(formatEventSpan("1798-06-12", "1798-06-13", "range")).toBe("12 – 13 June 1798");
    expect(formatEventSpan("1682", "1688", "range")).toBe("1682 – 1688");
  });
});

describe("timeline scale", () => {
  it("is monotonic and invertible", () => {
    let last = -1;
    for (let y = 600; y <= 2026; y += 7) {
      const p = yearToPosition(y);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
      expect(positionToYear(p)).toBeCloseTo(y, 6);
    }
  });
  it("gives the 1790s far more room than earlier centuries", () => {
    const decade1790s = yearToPosition(1801) - yearToPosition(1791);
    const century1600s = yearToPosition(1700) - yearToPosition(1613);
    expect(decade1790s).toBeGreaterThan(century1600s);
  });
  it("clamps out-of-range values", () => {
    expect(yearToPosition(100)).toBe(0);
    expect(yearToPosition(3000)).toBe(1);
    expect(positionToYear(-1)).toBe(600);
  });
  it("has ticks in ascending order", () => {
    expect([...AXIS_TICKS].sort((a, b) => a - b)).toEqual([...AXIS_TICKS]);
  });
  it("snaps to months in the 1790s", () => {
    expect(snapYear(1798.54) * 12).toBeCloseTo(Math.round(1798.54 * 12));
  });
});

describe("eras", () => {
  it("cover the whole timeline without gaps", () => {
    for (let i = 1; i < ERAS.length; i += 1) expect(ERAS[i]?.start).toBe(ERAS[i - 1]?.end);
  });
  it("puts 1798 in the Revolution chapter and 1941 in Partition and War", () => {
    expect(eraForYear(1798.54).id).toBe("revolution");
    expect(eraForYear(1941.3).id).toBe("partition");
    expect(eraForYear(2026.5).id).toBe("regeneration");
  });
});

describe("geometry helpers", () => {
  const centre: [number, number] = [-5.93, 54.5964];
  it("offsets by metres", () => {
    expect(distance(centre, offset(centre, 100, 0))).toBeCloseTo(100, 0);
    expect(distance(centre, offset(centre, 0, 250))).toBeCloseTo(250, 0);
  });
  it("builds closed rectangles of the right area", () => {
    const ring = rectangle(centre, 40, 20, 30);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ringArea(ring)).toBeCloseTo(800, -1);
    expect(pointInRing(centre, ring)).toBe(true);
  });
  it("builds courtyards with a hole", () => {
    const rings = courtyard(centre, 100, 90, 18);
    expect(rings).toHaveLength(2);
    expect(pointInPolygon(centre, rings)).toBe(false);
    expect(pointInPolygon(offset(centre, 45, 0), rings)).toBe(true);
  });
  it("builds circles and corridors", () => {
    expect(ringArea(circle(centre, 10, 64))).toBeCloseTo(Math.PI * 100, -1);
    const deck = corridor([centre, offset(centre, 256, 0)], 6.1);
    expect(ringArea(deck)).toBeCloseTo(256 * 6.1, -1);
  });
  it("places the camera behind and above the target", () => {
    const cam = cameraFromLookAt(centre, 0, 60, 1000);
    expect(cam.position[2]).toBeCloseTo(500, 0);
    expect(cam.position[1]).toBeLessThan(centre[1]); // looking north, camera is south
    expect(distance(centre, [cam.position[0], cam.position[1]])).toBeCloseTo(866, -1);
  });
});

describe("growth envelope", () => {
  const model: EnvelopeModel = {
    centre: [-5.9285, 54.5998],
    benchmarks: [
      { year: 1600, radii: [100, 100, 100, 100, 100, 100, 100, 100] },
      { year: 1800, radii: [1000, 500, 1000, 500, 1000, 500, 1000, 500] },
    ],
    outline_noise: 0,
    seed: 1,
  };
  it("interpolates radii in time", () => {
    expect(envelopeRadius(model, 1700, 0)).toBeCloseTo(550);
  });
  it("interpolates radii in angle", () => {
    expect(envelopeRadius(model, 1800, 22.5)).toBeCloseTo(750);
  });
  it("finds the year a point is first enclosed", () => {
    const point = offset(model.centre, 0, 550);
    expect(envelopeYearAt(model, point)).toBeCloseTo(1700, 0);
    expect(envelopeYearAt(model, offset(model.centre, 0, 5000))).toBe(Infinity);
    expect(envelopeYearAt(model, model.centre)).toBe(1600);
  });
  it("produces closed rings and checks monotonicity", () => {
    const ring = envelopeRing(model, 1750, 64);
    expect(ring).toHaveLength(65);
    expect(isMonotonic(model)).toBe(true);
    expect(isMonotonic({ ...model, benchmarks: [...model.benchmarks].reverse() })).toBe(false);
  });
  it("uses a deterministic random generator", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("shareable URL state", () => {
  it("round-trips", () => {
    const state = {
      ...DEFAULT_SHAREABLE,
      year: 1798.54,
      camera: { lon: -5.9284, lat: 54.5995, z: 120, heading: 250, tilt: 75 },
      eventId: "rev-execution-1798",
      tourId: "tour-1798",
      tourStep: 21,
      compareYear: 1900,
      viewMode: "plan" as const,
      basemap: "imagery" as const,
      overlayId: "illustrative-plan-1791",
      overlayOpacity: 0.5,
      modernOpacity: 0.1,
      hiddenLayers: ["massing", "uncertainty"],
    };
    expect(decodeState(encodeState(state))).toEqual(state);
  });
  it("ignores invalid or hostile values", () => {
    const s = decodeState("?y=abc&cam=1,2,3&e=<script>&b=hacker&ovo=9&hide=a.b.<x>");
    expect(s.year).toBe(DEFAULT_SHAREABLE.year);
    expect(s.camera).toBeNull();
    expect(s.eventId).toBeNull();
    expect(s.basemap).toBe("dark");
    expect(s.overlayOpacity).toBe(1);
    expect(s.hiddenLayers).toEqual(["a", "b"]);
  });
  it("clamps years to the timeline", () => {
    expect(decodeState("y=99999").year).toBeCloseTo(2026.99);
  });
});
