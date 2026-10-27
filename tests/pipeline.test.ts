/**
 * Tests for the data pipeline and for the integrity of the built dataset.
 * Run `npm run data:build` before these (CI does).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { irishGridToLonLat, itmToLonLat, parseIrishGridReference } from "../scripts/lib/grids";
import { chainLines, matchStreet } from "../scripts/lib/osm";
import { generateMassing, KIND_REDEVELOPMENT, KIND_TERRACE, styleForYear, type MassingFeature, type MassingParams } from "../scripts/lib/massing";
import { distance, offset, type LonLat } from "../src/engine/geo";
import { handoverState, isMassingShown, retireRange } from "../src/engine/handover";
import { isEventVisible, isPresent, MASSING_FEATURE_CAP, quantize, rendererBreaksFor, stableRendererYear } from "../src/engine/time";
import { ask } from "../src/engine/ask";
import { buildSearchIndex, search, type PlaceRecord } from "../src/engine/search";
import type { HistoricalEvent, SourceRecord } from "../src/types/history";

const DATA = resolve(__dirname, "../public/data");
const read = <T>(name: string): T => JSON.parse(readFileSync(resolve(DATA, name), { encoding: "utf-8" })) as T;

describe("Irish Grid and ITM conversion", () => {
  it("parses an 8-figure reference to the centre of its 10 m square", () => {
    expect(parseIrishGridReference("J3415 7442")).toEqual({ easting: 334155, northing: 374425, precision: 10 });
    expect(parseIrishGridReference("J 340 743").precision).toBe(100);
  });
  it("rejects malformed references", () => {
    expect(() => parseIrishGridReference("I1234")).toThrow();
    expect(() => parseIrishGridReference("J123")).toThrow();
  });
  it("places St George's (HB26/50/045) on High Street", () => {
    const ref = parseIrishGridReference("J3415 7442");
    const p = irishGridToLonLat(ref.easting, ref.northing);
    expect(distance(p, [-5.925, 54.6])).toBeLessThan(40); // Wikipedia gives 54°36′00″N 5°55′30″W
  });
  it("reproduces the published WGS84 position of excavation 2003:0011 from its ITM coordinates", () => {
    expect(distance(itmToLonLat(733890, 874304), [-5.927859, 54.599243])).toBeLessThan(2);
  });
});

describe("OSM street join", () => {
  const a: LonLat = [-5.93, 54.6];
  const b = offset(a, 100, 0);
  const c = offset(b, 100, 0);
  it("chains ways that share endpoints", () => {
    const chained = chainLines([[b, c], [a, b]]);
    expect(chained).toHaveLength(1);
    expect(chained[0]).toHaveLength(3);
  });
  it("matches by name and rejects same-named streets elsewhere", () => {
    const far = offset(a, 0, 5000);
    const osm = [
      { name: "High Street", coords: [a, b] },
      { name: "High Street", coords: [far, offset(far, 50, 0)] },
      { name: "Waring Street", coords: [a, c] },
    ];
    const match = matchStreet(osm, ["High Street"], [offset(a, 0, 20), offset(b, 0, 20)]);
    expect(match).toHaveLength(1);
    expect(matchStreet(osm, ["Joy's Entry"], [a, b])).toBeNull();
  });
});

describe("illustrative massing generator", () => {
  const params: MassingParams = {
    frontage_spacing_m: [14, 20], frontage_depth_m: [12, 16], frontage_offset_m: 10,
    terrace_length_m: [50, 70], terrace_depth_m: 20,
    terrace_row_spacing_m: [{ until_m: 400, step: 40 }, { until_m: 1200, step: 80 }],
    terrace_max_year: 1975, core_radius_m: 400, replacement_radius_m: 600,
    clearance_ring_m: [500, 1100], clearance_share: 0.3, clearance_years: [1960, 1982],
    fade_to_modern: [1986, 2008], max_features: 4000,
  };
  const centre: LonLat = [-5.9285, 54.5998];
  const styles = {
    medieval: { label: "", from: 0, height: [4, 6] as [number, number] },
    plantation: { label: "", from: 1613, height: [5, 8] as [number, number] },
    georgian: { label: "", from: 1700, height: [8, 12] as [number, number] },
    regency: { label: "", from: 1800, height: [9, 13] as [number, number] },
    victorian: { label: "", from: 1840, height: [11, 17] as [number, number] },
    edwardian: { label: "", from: 1900, height: [13, 20] as [number, number] },
    interwar: { label: "", from: 1921, height: [10, 16] as [number, number] },
    postwar: { label: "", from: 1945, height: [10, 30] as [number, number] },
    industrial: { label: "", from: 1830, height: [16, 24] as [number, number] },
    terrace: { label: "", from: 1820, height: [7, 9] as [number, number] },
  };
  const input = () => ({
    streets: [{ id: "main", cls: "main", segments: [{ coords: [offset(centre, -300, 0), offset(centre, 300, 0)], appear: 1700 }] }],
    envelope: { centre, benchmarks: [{ year: 1600, radii: Array(8).fill(200) }, { year: 1900, radii: Array(8).fill(1200) }], outline_noise: 0, seed: 7 },
    landYear: (p: LonLat) => (p[0] > centre[0] + 0.012 ? Infinity : -Infinity),
    exclusions: [{ centre, radius: 30, from: 1600 }],
    params,
    styles,
    seed: 99,
  });
  const features = generateMassing(input());

  it("is deterministic for a seed", () => {
    expect(generateMassing(input())).toEqual(features);
  });
  it("never places buildings in water", () => {
    for (const f of features) {
      const ring = f.geometry.coordinates[0] as LonLat[];
      const cx = ring.slice(0, 4).reduce((s, p) => s + p[0], 0) / 4;
      expect(cx).toBeLessThan(centre[0] + 0.0125);
    }
  });
  it("respects exclusion zones and the feature budget", () => {
    expect(features.length).toBeLessThanOrEqual(params.max_features);
    for (const f of features) {
      const ring = f.geometry.coordinates[0] as LonLat[];
      const c: LonLat = [ring.slice(0, 4).reduce((s, p) => s + p[0], 0) / 4, ring.slice(0, 4).reduce((s, p) => s + p[1], 0) / 4];
      expect(distance(c, centre)).toBeGreaterThan(25);
    }
  });
  it("produces valid time intervals and grows the core upward", () => {
    for (const f of features) {
      const p = f.properties;
      expect(p.b).toBeLessThanOrEqual(p.s);
      expect(p.e).toBeGreaterThan(p.s);
      expect(p.h).toBeGreaterThan(0);
    }
    const frontage = features.filter((f) => f.properties.t === 0);
    const early = frontage.filter((f) => isPresent({ build_start: f.properties.b, start_year: f.properties.s, end_year: f.properties.e }, 1750));
    const late = frontage.filter((f) => isPresent({ build_start: f.properties.b, start_year: f.properties.s, end_year: f.properties.e }, 1900));
    const mean = (list: typeof frontage) => list.reduce((s, f) => s + f.properties.h, 0) / Math.max(1, list.length);
    expect(early.length).toBeGreaterThan(0);
    expect(mean(late)).toBeGreaterThan(mean(early));
  });
  it("fills an industrial yard outward from its seed, within its polygon and dates", () => {
    const seed = offset(centre, -900, 0);
    const ring: LonLat[] = [offset(seed, -150, -100), offset(seed, 150, -100), offset(seed, 150, 100), offset(seed, -150, 100), offset(seed, -150, -100)];
    const yard = {
      id: "test-yard", ring, from: 1860, full_by: 1910, seed_point: seed, rotation_deg: 135,
      step_along_m: 90, step_across_m: 36, shed_length_m: [60, 80] as [number, number], shed_depth_m: [18, 24] as [number, number],
      height_m: [14, 20] as [number, number], end_years: [1985, 2000] as [number, number], surviving_share: 0.2,
    };
    const withYard = generateMassing({ ...input(), yards: [yard] });
    const sheds = withYard.filter((f) => {
      const r = f.geometry.coordinates[0] as LonLat[];
      const c: LonLat = [r.slice(0, 4).reduce((a, q) => a + q[0], 0) / 4, r.slice(0, 4).reduce((a, q) => a + q[1], 0) / 4];
      return f.properties.t === 2 && distance(c, seed) < 200;
    });
    expect(sheds.length).toBeGreaterThan(5);
    for (const f of sheds) {
      expect(f.properties.s).toBeGreaterThanOrEqual(1860);
      expect(f.properties.s).toBeLessThanOrEqual(1914);
    }
    const nearSeed = sheds.filter((f) => distance(f.geometry.coordinates[0]?.[0] as LonLat, seed) < 80);
    const farOut = sheds.filter((f) => distance(f.geometry.coordinates[0]?.[0] as LonLat, seed) > 130);
    const meanStart = (list: typeof sheds) => list.reduce((a, f) => a + f.properties.s, 0) / Math.max(1, list.length);
    expect(meanStart(nearSeed)).toBeLessThan(meanStart(farOut));
  });
  it("lets digitised extents decide when blocks appear", () => {
    const late = generateMassing({ ...input(), growthYear: () => 1890 });
    const terraces = late.filter((f) => f.properties.t === 1);
    expect(terraces.length).toBeGreaterThan(0);
    for (const f of terraces) expect(f.properties.s).toBeGreaterThanOrEqual(1890);
  });
  it("assigns period styles", () => {
    expect(styleForYear(1650, "frontage")).toBe("plantation");
    expect(styleForYear(1880, "frontage")).toBe("victorian");
    expect(styleForYear(1880, "terrace")).toBe("terrace");
  });

  describe("redevelopment after clearance", () => {
    const redevParams: MassingParams = { ...params, clearance_ring_m: [300, 1150], clearance_share: 0.6, max_features: 20000, redevelopment: { share: 0.8, gap_years: [2, 7], flats_until: 1975 } };
    const withStyles = { ...styles, redevelopment: { label: "", from: 1960, height: [8, 24] as [number, number] } };
    const rebuilt = generateMassing({ ...input(), params: redevParams, styles: withStyles });
    const vacant = generateMassing({ ...input(), params: { ...redevParams, redevelopment: undefined }, styles: withStyles });
    const centroid = (f: MassingFeature): LonLat => {
      const r = f.geometry.coordinates[0] as LonLat[];
      return [r.slice(0, 4).reduce((s, p) => s + p[0], 0) / 4, r.slice(0, 4).reduce((s, p) => s + p[1], 0) / 4];
    };
    const successors = rebuilt.filter((f) => f.properties.t === KIND_REDEVELOPMENT);

    it("rebuilds most cleared sites", () => {
      const cleared = rebuilt.filter((f) => f.properties.t === KIND_TERRACE && f.properties.e < 9999);
      expect(cleared.length).toBeGreaterThan(10);
      expect(successors.length / cleared.length).toBeGreaterThan(0.5);
    });
    it("puts each new block on a cleared site, after the clearance, before the handover", () => {
      const cleared = rebuilt.filter((f) => f.properties.t === KIND_TERRACE && f.properties.e < 9999);
      for (const s of successors) {
        const site = cleared.find((c) => distance(centroid(c), centroid(s)) < 1);
        expect(site, `successor ${s.properties.i}`).toBeDefined();
        expect(s.properties.b).toBeGreaterThanOrEqual((site as MassingFeature).properties.e); // never two buildings at once
        expect(s.properties.s).toBeGreaterThan((site as MassingFeature).properties.e);
        expect(s.properties.s).toBeLessThanOrEqual(1985);
        expect(s.properties.e).toBe(9999);
      }
    });
    it("leaves the rest of the model exactly as it was (separate random stream)", () => {
      const strip = (list: MassingFeature[]) => list.filter((f) => f.properties.t !== KIND_REDEVELOPMENT).map((f) => ({ ...f.properties, i: 0, r: 0, g: f.geometry }));
      expect(strip(rebuilt)).toEqual(strip(vacant));
    });
    it("gives every block a handover year inside the handover", () => {
      const [a, b] = retireRange(params.fade_to_modern);
      for (const f of rebuilt) {
        expect(f.properties.r).toBeGreaterThanOrEqual(a - 0.01);
        expect(f.properties.r).toBeLessThanOrEqual(b + 0.01);
      }
    });
  });
});

const built = existsSync(resolve(DATA, "events.json"));
describe.skipIf(!built)("built dataset integrity", () => {
  const events = built ? read<HistoricalEvent[]>("events.json") : [];
  const sources = built ? read<SourceRecord[]>("sources.json") : [];
  const places = built ? read<PlaceRecord[]>("places.json") : [];
  const sourceIds = new Set(sources.map((s) => s.id));

  it("has the brief's required fields on every event", () => {
    const required = [
      "event_id", "title", "description", "start_date", "end_date", "date_precision", "event_category", "people",
      "location_name", "historical_location_name", "longitude", "latitude", "geometry_type", "location_precision",
      "historical_confidence", "interpretation_status", "source_name", "source_url", "image_url", "image_rights",
      "3d_reconstruction_available", "related_event_ids", "timeline_importance",
    ];
    for (const e of events) for (const key of required) expect(e, `${e.event_id}.${key}`).toHaveProperty(key);
  });
  it("cites only registered sources", () => {
    for (const e of events) for (const id of e.source_ids) expect(sourceIds.has(id), `${e.event_id} → ${id}`).toBe(true);
  });
  it("never gives an unmapped event coordinates, nor a mapped one without an uncertainty", () => {
    for (const e of events) {
      if (e.location_precision === "unmapped") expect(e.longitude).toBeNull();
      else expect(e.location_uncertainty_m).toBeGreaterThan(0);
    }
  });
  it("labels traditions as traditions", () => {
    const wake = events.find((e) => e.event_id === "rev-wake-tradition");
    expect(wake?.historical_confidence).toBe("tradition");
    expect(wake?.interpretation_status).toBe("tradition-unverified");
  });
  it("records the 1798 execution with the documented date and place", () => {
    const e = events.find((x) => x.event_id === "rev-execution-1798");
    expect(e?.start_date).toBe("1798-07-17");
    expect(e?.place_id).toBe("market-house-site");
    expect(e?.details.some((d) => d.label === "Age" && d.value.startsWith("30"))).toBe(true);
    expect(isEventVisible(e as HistoricalEvent, 1798.6)).toBe(true);
  });
  it("keeps every place inside the study area", () => {
    for (const p of places) {
      expect(p.lon).toBeGreaterThan(-6.5);
      expect(p.lon).toBeLessThan(-5.5);
      expect(p.lat).toBeGreaterThan(54.3);
      expect(p.lat).toBeLessThan(55);
    }
  });
  it("fits the whole massing layer under the 3D view's feature cap", () => {
    const massing = read<{ features: unknown[] }>("massing.geojson").features;
    expect(massing.length).toBeLessThanOrEqual(MASSING_FEATURE_CAP);
  });

  describe("illustrative city through clearance and handover", () => {
    const manifest = built ? read<{ fade_to_modern: [number, number]; phases?: { handover_field?: string } }>("manifest.json") : { fade_to_modern: [1986, 2008] as [number, number] };
    const massing = built ? read<{ features: MassingFeature[] }>("massing.geojson").features : [];
    const centre: LonLat = [-5.9285, 54.5998];
    const centroid = (f: MassingFeature): LonLat => {
      const r = f.geometry.coordinates[0] as LonLat[];
      return [r.slice(0, 4).reduce((s, p) => s + p[0], 0) / 4, r.slice(0, 4).reduce((s, p) => s + p[1], 0) / 4];
    };
    const standing = (list: MassingFeature[], year: number) => list.filter((f) => isMassingShown(f.properties, year, false)).length;

    it("never hollows out: the inner ring keeps its buildings through 1960–85", () => {
      const ring = massing.filter((f) => {
        const d = distance(centroid(f), centre);
        return d > 800 && d < 2600;
      });
      expect(standing(ring, 1985) / standing(ring, 1960)).toBeGreaterThan(0.93); // was 0.85 with cleared sites left vacant
      for (let y = 1700; y <= manifest.fade_to_modern[0] - 5; y += 0.5) {
        const a = standing(massing, y);
        expect((a - standing(massing, y + 5)) / a, `${y}–${y + 5}`).toBeLessThan(0.015);
      }
    });
    it("records the handover field and a handover year on every block", () => {
      expect(manifest.phases?.handover_field).toBe("r");
      const [a, b] = retireRange(manifest.fade_to_modern);
      for (const f of massing) {
        expect(f.properties.r).toBeGreaterThanOrEqual(a - 0.01);
        expect(f.properties.r).toBeLessThanOrEqual(b + 0.01);
      }
    });
    it("keeps a full city on screen through the handover", () => {
      const [start, end] = manifest.fade_to_modern;
      const before = standing(massing, start - 0.01);
      for (let y = start; y <= end; y += 0.25) {
        const shown = massing.filter((f) => isMassingShown(f.properties, y, true)).length / before;
        const modern = handoverState(y, manifest.fade_to_modern, { modernOpacity: 0.35, modernAvailable: true }).modernOpacity;
        expect(modern + shown, `year ${y}`).toBeGreaterThanOrEqual(0.99);
      }
      expect(massing.filter((f) => isMassingShown(f.properties, end, true))).toHaveLength(0);
    });
  });

  it("rebuilds the landmark renderer only around construction dates", () => {
    const features = read<{ features: { properties: Record<string, unknown> }[] }>("landmarks.geojson").features;
    const { breaks, active } = rendererBreaksFor("landmarks", features);
    const years = Array.from({ length: (2026 - 600) * 4 + 1 }, (_, i) => 600 + i / 4);
    const before = new Set(years.map((y) => quantize(y, 0.25))).size;
    const after = new Set(years.map((y) => stableRendererYear(quantize(y, 0.25), breaks, active))).size;
    expect(after).toBeLessThan(before / 4);
  });
  it("shows the Market House standing in 1798 and gone by 1820", () => {
    const parts = read<{ features: { properties: { landmark_id: string; build_start: number; start_year: number; end_year: number } }[] }>("landmarks.geojson").features
      .filter((f) => f.properties.landmark_id === "market-house")
      .map((f) => ({ build_start: f.properties.build_start, start_year: f.properties.start_year, end_year: f.properties.end_year }));
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((p) => isPresent(p, 1798.54))).toBe(true);
    expect(parts.some((p) => isPresent(p, 1820))).toBe(false);
  });
  it("answers the brief's example questions deterministically", () => {
    const index = buildSearchIndex(events, places);
    expect(ask(index, "Show Belfast in 1798").actions[0]).toEqual({ type: "set-year", year: 1798.45 });
    expect(ask(index, "Where did the United Irishmen meet?").intent).toBe("united-irish-meetings");
    expect(ask(index, "Show the Crown Tavern").intent).toBe("crown-tavern");
    expect(ask(index, "Take me to where Henry Joy McCracken was executed").intent).toBe("mccracken-execution");
    const star = ask(index, "What is the connection between the Morning Star and 1798?");
    expect(star.intent).toBe("morning-star");
    expect(star.text).toMatch(/tradition/i);
    expect(ask(index, "Show Belfast before the shipyards").actions[0]).toEqual({ type: "set-year", year: 1840 });
    expect(ask(index, "Compare 1850 with 1900").actions[0]).toEqual({ type: "compare", year: 1850, compareYear: 1900 });
    expect(ask(index, "How did Belfast's docks change?").intent).toBe("docks");
    const mary = ask(index, "Show all locations associated with Mary Ann McCracken");
    expect(mary.intent).toBe("person");
    expect(mary.eventIds).toContain("rev-execution-1798");
    expect(ask(index, "Fly to the Belfast Blitz sites").intent).toBe("blitz");
  });
  it("finds people and places by name", () => {
    const index = buildSearchIndex(events, places);
    expect(search(index, "Wolfe Tone")[0]?.kind).toBe("person");
    expect(search(index, "Crown Entry").some((r) => r.id === "crown-entry")).toBe(true);
  });
});
