/**
 * Belfast Rising data build.
 *
 * Validates the curated historical datasets in data/curated/, resolves the
 * gazetteer, derives the full event schema, generates the schematic growth
 * model (envelope, shoreline states, street segments, illustrative massing)
 * and writes everything the app needs to public/data/.
 *
 * Usage:
 *   npm run data:build              # validate + build
 *   npm run data:validate           # validate only (CI)
 *
 * The build is deterministic: the same inputs always produce the same
 * outputs (seeded randomness, no timestamps except the manifest date).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";

import { ERAS, eraForYear } from "../src/data/eras";
import { toDecimalYear } from "../src/engine/dates";
import { envelopeRing, envelopeYearAt, isMonotonic, type EnvelopeModel } from "../src/engine/envelope";
import {
  circle,
  corridor,
  courtyard,
  distance,
  offset,
  pointInRing,
  polylineLength,
  rectangle,
  toLocal,
  type LonLat,
  type Ring,
} from "../src/engine/geo";
import { retireRange } from "../src/engine/handover";
import { MASSING_FEATURE_CAP, PRESENT_SENTINEL } from "../src/engine/time";
import type {
  EventCategory,
  GeometryBasis,
  HistoricalConfidence,
  HistoricalEvent,
  InterpretationStatus,
  LocationPrecision,
} from "../src/types/history";
import { irishGridToLonLat, itmToLonLat, parseIrishGridReference } from "./lib/grids";
import { generateMassing, LAST_GENERATED_YEAR, type MassingParams, type StreetForMassing, type StyleDef, type YardZone } from "./lib/massing";
import { matchStreet, readOsmLines, type OsmLine } from "./lib/osm";

// ── Paths and logging ─────────────────────────────────────────────────────────
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CURATED = resolve(ROOT, "data/curated");
const OSM_FILE = resolve(ROOT, "data/osm/streets.geojson");
const EXTENTS_DIR = resolve(ROOT, "data/extents");
const OUT = resolve(ROOT, "public/data");
const MAPS_OUT = resolve(ROOT, "public/maps");
const VALIDATE_ONLY = process.argv.includes("--validate-only");

const log = {
  info: (msg: string) => console.info(`[data] ${msg}`),
  warn: (msg: string) => console.warn(`[data] WARN ${msg}`),
};

/** Bounding box for any place in this project (greater Belfast, Antrim and Down). */
const STUDY_BBOX = { xmin: -6.5, ymin: 54.3, xmax: -5.5, ymax: 55.0 };
/** Street segments are cut to about this length so they can appear progressively. */
const STREET_SEGMENT_M = 45;
/** Reclaimed land is highlighted for this many years after it appears. */
const NEW_LAND_HIGHLIGHT_YEARS = 25;

const CONFIDENCE: HistoricalConfidence[] = ["documented", "probable", "approximate", "tradition"];
const STATUS: InterpretationStatus[] = ["established", "disputed", "competing-dates", "single-source", "tradition-unverified", "estimate"];
const CATEGORIES: EventCategory[] = [
  "origins", "civic", "political", "rebellion", "military", "industry", "maritime", "transport", "religion",
  "culture", "architecture", "conflict", "blitz", "demography", "regeneration", "archaeology", "commemoration",
];
const PRECISIONS = ["day", "month", "year", "decade", "century", "range"];
const BASES: GeometryBasis[] = ["surveyed", "georeferenced", "approximate", "schematic", "illustrative"];

const errors: string[] = [];
function fail(msg: string): void {
  errors.push(msg);
}

function readJson<T>(name: string): T {
  const path = resolve(CURATED, name);
  try {
    return JSON.parse(readFileSync(path, { encoding: "utf-8" })) as T;
  } catch (error) {
    throw new Error(`Could not read ${path}: ${(error as Error).message}`, { cause: error });
  }
}

function writeJson(name: string, data: unknown): void {
  writeFileSync(resolve(OUT, name), `${JSON.stringify(data)}\n`, { encoding: "utf-8" });
}

const round = (v: number, dp = 6): number => Math.round(v * 10 ** dp) / 10 ** dp;
const roundRing = (ring: Ring): Ring => ring.map(([x, y]) => [round(x), round(y)] as LonLat);

// ── Curated input types ───────────────────────────────────────────────────────
interface SourceIn { id: string; name: string; publisher: string; url: string | null; kind: string; licence?: string; notes?: string; accessed?: string }
interface PlaceIn { id: string; name: string; historical_name: string; lonlat?: LonLat; irish_grid?: string; itm?: [number, number]; uncertainty_m: number; basis: GeometryBasis; derivation: string; source_ids: string[] }
interface EventIn {
  id: string; title: string; date: string; end?: string | null; precision: string; category: EventCategory; people: string[];
  place: string | null; historical_location_name: string | null; confidence: HistoricalConfidence; status: InterpretationStatus;
  importance: number; summary: string; sources: string[]; chapter?: string; interpretations?: { label: string; claim: string; source_ids: string[] }[];
  details?: { label: string; value: string; source_ids: string[] }[]; related?: string[]; landmark?: string; media?: { title: string; url: string; licence?: string; creator?: string }[];
  content_note?: string; camera?: { heading: number; tilt: number; range: number; approach?: "high-street" }; tags?: string[]; trail_stop?: number;
}
interface PartIn { shape: "rect" | "court" | "circle" | "deck"; w?: number; d?: number; t?: number; r?: number; dx?: number; dy?: number; rot?: number; h: number; base?: number; path?: LonLat[]; width?: number }
interface PhaseIn { build_start: number; start: number; end: number | null; style: string; parts: PartIn[] }
interface LandmarkIn { id: string; name: string; place: string; rot: number; status: "surviving" | "lost" | "replaced"; confidence: HistoricalConfidence; height_basis: "documented" | "inferred" | "illustrative"; footprint_basis: string; source_ids: string[]; notes?: string; phases: PhaseIn[] }
interface StreetIn { id: string; name: string; osm_names: string[]; class: string; first_evidence: number | null; first_evidence_source_ids?: string[]; first_evidence_note?: string; dated?: boolean; status?: string; chapter?: string; coords: LonLat[]; closures?: { from: number; to: number; note: string }[] }
interface LandIn { id: string; name: string; kind: string; build_start: number; start: number; confidence: HistoricalConfidence; geometry_basis: GeometryBasis; note: string; source_ids: string[]; coords: LonLat[] }
interface ShorelineIn {
  estuary_before_reclamation: { name: string; source_ids: string[]; coords: LonLat[] };
  river: { name: string; source_ids: string[]; coords: LonLat[] };
  farset: { name: string; source_ids: string[]; start: number; end: number; end_note: string; width_m: number; coords: LonLat[] };
  land: LandIn[];
  channel: { id: string; name: string; build_start: number; start: number; confidence: HistoricalConfidence; geometry_basis: GeometryBasis; width_m: number; note: string; source_ids: string[]; coords: LonLat[] };
  mudflats_until: { year: number; note: string; source_ids: string[] };
}
interface YardIn extends Omit<YardZone, "ring"> { name: string; land: string; source_ids: string[]; note: string }
interface GrowthIn extends EnvelopeModel { step_years: number; massing: MassingParams & { yards?: YardIn[] }; styles: Record<string, StyleDef> }

// ── Load ──────────────────────────────────────────────────────────────────────
const sourcesIn = readJson<{ accessed_default: string; sources: SourceIn[] }>("sources.json");
const placesIn = readJson<{ places: PlaceIn[] }>("places.json").places;
const eventsIn = readJson<{ events: EventIn[] }>("events.json").events;
const landmarksIn = readJson<{ landmarks: LandmarkIn[] }>("landmarks.json").landmarks;
const streetsFile = readJson<{ streets: StreetIn[]; lost_entries: { name: string; note: string; source_ids: string[] }[] }>("streets.json");
const shoreline = readJson<ShorelineIn>("shoreline.json");
const transport = readJson<{ lines: { id: string; name: string; kind: string; start: number; end: number | null; confidence: HistoricalConfidence; geometry_basis: GeometryBasis; source_ids: string[]; note: string; coords: LonLat[] }[] }>("transport.json");
const growth = readJson<GrowthIn>("growth.json");
const population = readJson<{ source_ids: string[]; series: { year: number; population: number; note?: string }[]; alternates: { year: number; population: number; label: string; source_ids: string[] }[] }>("population.json");
const trailIn = readJson<{ id: string; title: string; path_basis: string; stops: { order: number; place: string; event_id: string; label: string }[]; path: LonLat[] }>("trail.json");
const toursIn = readJson<{ tours: { id: string; steps: string[]; intro: { year: number } }[] }>("tours.json");
const overlaysIn = readJson<{ overlays: { id: string; kind: string; url: string; georeference?: { xmin: number; ymin: number; xmax: number; ymax: number }; enabled: boolean }[] }>("historic-maps.json");

// ── Sources ───────────────────────────────────────────────────────────────────
const sources = new Map<string, SourceIn & { accessed: string }>();
for (const s of sourcesIn.sources) {
  if (sources.has(s.id)) fail(`Duplicate source id ${s.id}`);
  if (!s.name || !s.publisher) fail(`Source ${s.id} needs name and publisher`);
  if (s.url !== null && !/^https:\/\//.test(s.url)) fail(`Source ${s.id} URL must be https`);
  sources.set(s.id, { ...s, accessed: s.accessed ?? sourcesIn.accessed_default });
}
const checkSources = (ids: string[] | undefined, where: string, allowEmpty = false): void => {
  if (!ids || (ids.length === 0 && !allowEmpty)) fail(`${where}: at least one source id is required`);
  for (const id of ids ?? []) if (!sources.has(id)) fail(`${where}: unknown source id "${id}"`);
};

// ── Places ────────────────────────────────────────────────────────────────────
interface ResolvedPlace extends PlaceIn { lon: number; lat: number }
const places = new Map<string, ResolvedPlace>();
for (const p of placesIn) {
  if (places.has(p.id)) fail(`Duplicate place id ${p.id}`);
  let coord: LonLat | null = null;
  try {
    if (p.irish_grid) {
      const ref = parseIrishGridReference(p.irish_grid);
      coord = irishGridToLonLat(ref.easting, ref.northing);
    } else if (p.itm) {
      coord = itmToLonLat(p.itm[0], p.itm[1]);
    } else if (p.lonlat) {
      coord = p.lonlat;
    }
  } catch (error) {
    fail(`Place ${p.id}: ${(error as Error).message}`);
  }
  if (!coord) {
    fail(`Place ${p.id} has no coordinates`);
    continue;
  }
  const [lon, lat] = coord;
  if (lon < STUDY_BBOX.xmin || lon > STUDY_BBOX.xmax || lat < STUDY_BBOX.ymin || lat > STUDY_BBOX.ymax) {
    fail(`Place ${p.id} (${lon}, ${lat}) lies outside the study area`);
  }
  if (!(p.uncertainty_m > 0)) fail(`Place ${p.id} needs a positive uncertainty_m`);
  if (!BASES.includes(p.basis)) fail(`Place ${p.id} has unknown basis ${p.basis}`);
  if (!p.derivation) fail(`Place ${p.id} must explain how its position was derived`);
  checkSources(p.source_ids, `Place ${p.id}`);
  places.set(p.id, { ...p, lon: round(lon), lat: round(lat) });
}

function locationPrecision(place: ResolvedPlace): LocationPrecision {
  if (place.uncertainty_m <= 25 && place.basis === "georeferenced") return "building";
  if (place.uncertainty_m <= 80) return "street";
  if (place.uncertainty_m <= 450) return "approximate";
  return "town";
}

// ── Landmarks (validated early: events reference them) ───────────────────────
const landmarkIds = new Set<string>();
for (const lm of landmarksIn) {
  if (landmarkIds.has(lm.id)) fail(`Duplicate landmark id ${lm.id}`);
  landmarkIds.add(lm.id);
  if (!places.has(lm.place)) fail(`Landmark ${lm.id}: unknown place ${lm.place}`);
  checkSources(lm.source_ids, `Landmark ${lm.id}`);
  if (!CONFIDENCE.includes(lm.confidence)) fail(`Landmark ${lm.id}: bad confidence`);
  lm.phases.forEach((ph, i) => {
    if (ph.build_start > ph.start) fail(`Landmark ${lm.id} phase ${i}: build_start after start`);
    if (ph.end !== null && ph.end <= ph.start) fail(`Landmark ${lm.id} phase ${i}: end must follow start`);
    if (!growth.styles[ph.style]) fail(`Landmark ${lm.id} phase ${i}: unknown style ${ph.style}`);
    for (const part of ph.parts) if (!(part.h > 0)) fail(`Landmark ${lm.id} phase ${i}: part height must be positive`);
  });
}

// ── Events ────────────────────────────────────────────────────────────────────
const eventIds = new Set(eventsIn.map((e) => e.id));
if (eventIds.size !== eventsIn.length) fail("Duplicate event ids in events.json");
const events: HistoricalEvent[] = [];
for (const e of eventsIn) {
  const where = `Event ${e.id}`;
  if (!e.title || !e.summary) fail(`${where}: title and summary are required`);
  if (!CATEGORIES.includes(e.category)) fail(`${where}: unknown category ${e.category}`);
  if (!CONFIDENCE.includes(e.confidence)) fail(`${where}: unknown confidence ${e.confidence}`);
  if (!STATUS.includes(e.status)) fail(`${where}: unknown status ${e.status}`);
  if (!PRECISIONS.includes(e.precision)) fail(`${where}: unknown precision ${e.precision}`);
  if (![1, 2, 3, 4, 5].includes(e.importance)) fail(`${where}: importance must be 1–5`);
  checkSources(e.sources, where);
  for (const i of e.interpretations ?? []) checkSources(i.source_ids, `${where} interpretation "${i.label}"`, true);
  for (const d of e.details ?? []) checkSources(d.source_ids, `${where} detail "${d.label}"`, true);
  for (const r of e.related ?? []) if (!eventIds.has(r)) fail(`${where}: related event ${r} does not exist`);
  if (e.landmark && !landmarkIds.has(e.landmark)) fail(`${where}: unknown landmark ${e.landmark}`);
  if (e.status === "competing-dates" && (e.interpretations ?? []).length < 2) fail(`${where}: competing dates need at least two interpretations`);
  if (e.confidence === "tradition" && !/tradition|reported|accounts|recollection|unverified|later/i.test(e.summary)) {
    fail(`${where}: tradition-level events must say so in the description`);
  }

  let startYear = NaN;
  let endYear = NaN;
  try {
    startYear = toDecimalYear(e.date, "start");
    endYear = e.end ? toDecimalYear(e.end, "end") : toDecimalYear(e.date, "end");
  } catch (error) {
    fail(`${where}: ${(error as Error).message}`);
  }
  if (endYear < startYear) fail(`${where}: end date precedes start date`);

  const place = e.place ? places.get(e.place) : undefined;
  if (e.place && !place) fail(`${where}: unknown place ${e.place}`);
  const primary = sources.get(e.sources[0] ?? "");
  const firstMedia = e.media?.[0];

  events.push({
    event_id: e.id,
    title: e.title,
    description: e.summary,
    start_date: e.date,
    end_date: e.end ?? null,
    date_precision: e.precision as HistoricalEvent["date_precision"],
    start_year: round(startYear, 4),
    end_year: round(endYear, 4),
    event_category: e.category,
    people: e.people ?? [],
    location_name: place ? place.name : null,
    historical_location_name: e.historical_location_name ?? place?.historical_name ?? null,
    longitude: place ? place.lon : null,
    latitude: place ? place.lat : null,
    geometry_type: place ? "Point" : null,
    location_precision: place ? locationPrecision(place) : "unmapped",
    location_uncertainty_m: place ? place.uncertainty_m : null,
    location_basis: place ? place.basis : null,
    location_derivation: place ? place.derivation : null,
    place_id: place ? place.id : null,
    historical_confidence: e.confidence,
    interpretation_status: e.status,
    source_name: primary ? `${primary.name} — ${primary.publisher}` : "",
    source_url: primary?.url ?? null,
    source_ids: e.sources,
    image_url: null,
    image_rights: firstMedia?.licence ? `${firstMedia.licence}${firstMedia.creator ? `, ${firstMedia.creator}` : ""} (linked, not redistributed)` : null,
    media_links: e.media ?? [],
    "3d_reconstruction_available": Boolean(e.landmark),
    related_event_ids: e.related ?? [],
    timeline_importance: e.importance as HistoricalEvent["timeline_importance"],
    era_id: eraForYear(startYear).id,
    chapter: e.chapter === "1798" ? "1798" : null,
    interpretations: e.interpretations ?? [],
    details: e.details ?? [],
    tags: e.tags ?? [],
    content_note: e.content_note ?? null,
    camera: e.camera ?? null,
    landmark_id: e.landmark ?? null,
    trail_stop: e.trail_stop ?? null,
  });
}
events.sort((a, b) => a.start_year - b.start_year || b.timeline_importance - a.timeline_importance);

// ── Growth model checks ───────────────────────────────────────────────────────
const envelopeModel: EnvelopeModel = {
  centre: growth.centre,
  benchmarks: growth.benchmarks,
  outline_noise: growth.outline_noise,
  seed: growth.seed,
};
if (!isMonotonic(envelopeModel)) fail("growth.json: envelope radii must never shrink between benchmarks");

// ── Tours and trail references ───────────────────────────────────────────────
for (const tour of toursIn.tours) for (const step of tour.steps) if (!eventIds.has(step)) fail(`Tour ${tour.id}: unknown event ${step}`);
for (const stop of trailIn.stops) {
  if (!places.has(stop.place)) fail(`Trail stop ${stop.order}: unknown place ${stop.place}`);
  if (!eventIds.has(stop.event_id)) fail(`Trail stop ${stop.order}: unknown event ${stop.event_id}`);
}

if (errors.length > 0) {
  console.error(`[data] ${errors.length} validation error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
log.info(`Validated ${sources.size} sources, ${places.size} places, ${events.length} events, ${landmarksIn.length} landmarks.`);
if (VALIDATE_ONLY) process.exit(0);

mkdirSync(OUT, { recursive: true });
mkdirSync(MAPS_OUT, { recursive: true });

// ── Shoreline states ─────────────────────────────────────────────────────────
type Poly = Feature<Polygon | MultiPolygon>;
const closeRing = (coords: LonLat[]): LonLat[] => {
  const first = coords[0] as LonLat;
  const last = coords[coords.length - 1] as LonLat;
  return first[0] === last[0] && first[1] === last[1] ? coords : [...coords, first];
};
const estuary = turf.polygon([closeRing(shoreline.estuary_before_reclamation.coords)]);
const river = turf.polygon([closeRing(shoreline.river.coords)]);
const lands = [...shoreline.land].sort((a, b) => a.start - b.start);
const channelRing = corridor(shoreline.channel.coords, shoreline.channel.width_m);

function subtract(a: Poly | null, b: Poly): Poly | null {
  if (!a) return null;
  return (turf.difference(turf.featureCollection([a, b])) as Poly | null) ?? null;
}

interface WaterState { from: number; to: number; geometry: Poly }
const waterStates: WaterState[] = [];
{
  let current: Poly | null = estuary;
  let from = 600;
  for (const land of lands) {
    if (current) waterStates.push({ from, to: land.start, geometry: current });
    current = subtract(current, turf.polygon([closeRing(land.coords)]));
    from = land.start;
  }
}

/** Water (estuary state + river) at `year` — used to clip the envelope. */
function waterAt(year: number): Poly {
  const state = waterStates.find((w) => year >= w.from && year < w.to);
  if (!state) return river;
  return (turf.union(turf.featureCollection([state.geometry, river])) as Poly | null) ?? river;
}

const estuaryRing = closeRing(shoreline.estuary_before_reclamation.coords);
const riverRing = closeRing(shoreline.river.coords);
const landRings = lands.map((l) => ({ start: l.start, ring: closeRing(l.coords) }));
function landYear(p: LonLat): number {
  if (pointInRing(p, riverRing) || pointInRing(p, channelRing)) return Infinity;
  if (!pointInRing(p, estuaryRing)) return -Infinity;
  const land = landRings.find((l) => pointInRing(p, l.ring));
  return land ? land.start : Infinity;
}

const waterFeatures: Poly[] = [];
for (const [i, state] of waterStates.entries()) {
  waterFeatures.push({
    type: "Feature",
    geometry: state.geometry.geometry,
    properties: {
      feature_id: `estuary-${i}`, name: i === 0 ? shoreline.estuary_before_reclamation.name : "Remaining intertidal flats (schematic)",
      kind: "intertidal", build_start: state.from, start_year: state.from, end_year: state.to,
      geometry_basis: "schematic", historical_confidence: "approximate",
      source_ids: shoreline.estuary_before_reclamation.source_ids.join(","),
      note: "Schematic outline of water and mudflats before reclamation.",
    },
  });
}
waterFeatures.push(
  { type: "Feature", geometry: river.geometry, properties: { feature_id: "lagan-tidal", name: "River Lagan — tidal, mudflats exposed at low water", kind: "tidal-river", build_start: 600, start_year: 600, end_year: shoreline.mudflats_until.year, geometry_basis: "schematic", historical_confidence: "documented", source_ids: shoreline.mudflats_until.source_ids.join(","), note: shoreline.mudflats_until.note } },
  { type: "Feature", geometry: river.geometry, properties: { feature_id: "lagan-impounded", name: "River Lagan — impounded by the Lagan Weir", kind: "river", build_start: shoreline.mudflats_until.year, start_year: shoreline.mudflats_until.year, end_year: PRESENT_SENTINEL, geometry_basis: "schematic", historical_confidence: "documented", source_ids: shoreline.mudflats_until.source_ids.join(","), note: "Held at a constant level since 1994." } },
  { type: "Feature", geometry: { type: "Polygon", coordinates: [roundRing(corridor(shoreline.farset.coords, shoreline.farset.width_m))] }, properties: { feature_id: "farset-open", name: shoreline.farset.name, kind: "river", build_start: shoreline.farset.start, start_year: shoreline.farset.start, end_year: shoreline.farset.end, geometry_basis: "schematic", historical_confidence: "probable", source_ids: shoreline.farset.source_ids.join(","), note: shoreline.farset.end_note } },
  { type: "Feature", geometry: { type: "Polygon", coordinates: [roundRing(channelRing)] }, properties: { feature_id: shoreline.channel.id, name: shoreline.channel.name, kind: "channel", build_start: shoreline.channel.build_start, start_year: shoreline.channel.start, end_year: PRESENT_SENTINEL, geometry_basis: shoreline.channel.geometry_basis, historical_confidence: shoreline.channel.confidence, source_ids: shoreline.channel.source_ids.join(","), note: shoreline.channel.note } },
);

const landFeatures = lands.map((l) => ({
  type: "Feature" as const,
  geometry: { type: "Polygon" as const, coordinates: [closeRing(l.coords)] },
  properties: {
    feature_id: l.id, name: l.name, kind: l.kind, build_start: l.build_start, start_year: l.start, end_year: PRESENT_SENTINEL,
    highlight_until: l.start + NEW_LAND_HIGHLIGHT_YEARS, geometry_basis: l.geometry_basis, historical_confidence: l.confidence,
    source_ids: l.source_ids.join(","), note: l.note,
  },
}));

// ── Digitised extents (optional) ─────────────────────────────────────────────
/**
 * When data/extents/*.geojson exist, they replace the schematic envelope from
 * the earliest digitised year onwards, and they decide when each street
 * segment and massing block appears. Each feature must be a Polygon or
 * MultiPolygon with properties { year: number, source_ids: string[] (or a
 * comma-separated string) naming registered sources, note?: string }.
 * Features sharing a year are merged.
 */
interface Extent { year: number; geometry: Poly; source_ids: string[]; note: string }

function readExtents(): Extent[] {
  if (!existsSync(EXTENTS_DIR)) return [];
  const byYear = new Map<number, Extent>();
  const files = readdirSync(EXTENTS_DIR).filter((f) => f.endsWith(".geojson") || f.endsWith(".json")).sort();
  for (const file of files) {
    let parsed: { features?: Feature[] };
    try {
      parsed = JSON.parse(readFileSync(resolve(EXTENTS_DIR, file), { encoding: "utf-8" })) as { features?: Feature[] };
    } catch (error) {
      fail(`data/extents/${file}: not valid JSON (${(error as Error).message})`);
      continue;
    }
    for (const [i, f] of (parsed.features ?? []).entries()) {
      const where = `data/extents/${file} feature ${i}`;
      const props = (f.properties ?? {}) as { year?: unknown; source_ids?: unknown; note?: unknown };
      const year = Number(props.year);
      if (!Number.isFinite(year) || year < 600 || year > 2026) {
        fail(`${where}: "year" must be a number between 600 and 2026`);
        continue;
      }
      if (f.geometry?.type !== "Polygon" && f.geometry?.type !== "MultiPolygon") {
        fail(`${where}: geometry must be a Polygon or MultiPolygon`);
        continue;
      }
      const ids = Array.isArray(props.source_ids)
        ? props.source_ids.map(String)
        : typeof props.source_ids === "string"
          ? props.source_ids.split(",").map((x) => x.trim()).filter(Boolean)
          : [];
      if (ids.length === 0) {
        fail(`${where}: "source_ids" must cite the map(s) the extent was digitised from`);
        continue;
      }
      checkSources(ids, where);
      const [xmin, ymin, xmax, ymax] = turf.bbox(f);
      if (xmin < STUDY_BBOX.xmin || ymin < STUDY_BBOX.ymin || xmax > STUDY_BBOX.xmax || ymax > STUDY_BBOX.ymax) {
        fail(`${where}: lies outside the study area — is it in WGS84 longitude/latitude?`);
        continue;
      }
      const poly = turf.feature(f.geometry as Polygon | MultiPolygon) as Poly;
      const existing = byYear.get(year);
      if (existing) {
        existing.geometry = (turf.union(turf.featureCollection([existing.geometry, poly])) as Poly | null) ?? existing.geometry;
        existing.source_ids = [...new Set([...existing.source_ids, ...ids])];
      } else {
        byYear.set(year, { year, geometry: poly, source_ids: ids, note: typeof props.note === "string" ? props.note : "" });
      }
    }
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

const extents = readExtents();
if (extents.length) log.info(`Using ${extents.length} digitised extent(s) from data/extents/ (${extents.map((e) => e.year).join(", ")}).`);

/**
 * First year a point lies inside the built-up area. Without digitised
 * extents this is the schematic envelope. With them, a point inside extent k
 * appears between extent k-1 and k, interpolated by distance so growth spreads
 * outward from the earlier edge; beyond the last extent the schematic
 * envelope continues the story.
 */
function growthYear(p: LonLat): number {
  const schematic = envelopeYearAt(envelopeModel, p);
  const first = extents[0];
  const last = extents[extents.length - 1];
  if (!first || !last) return schematic;
  const pt = turf.point(p);
  const k = extents.findIndex((e) => turf.booleanPointInPolygon(pt, e.geometry));
  if (k < 0) return Number.isFinite(schematic) ? Math.max(schematic, last.year + 0.5) : Infinity;
  const ext = extents[k] as Extent;
  if (k === 0) return Math.min(schematic, ext.year);
  const prev = extents[k - 1] as Extent;
  const fromPrev = Math.max(0, turf.pointToPolygonDistance(pt, prev.geometry, { units: "meters" }));
  const toEdge = Math.abs(turf.pointToPolygonDistance(pt, ext.geometry, { units: "meters" }));
  const t = fromPrev / Math.max(1, fromPrev + toEdge);
  return prev.year + (ext.year - prev.year) * t;
}

function intersect(a: Poly, b: Poly): Poly | null {
  return (turf.intersect(turf.featureCollection([a, b])) as Poly | null) ?? null;
}

// ── Envelope ─────────────────────────────────────────────────────────────────
const envelopeYears: number[] = [600, 1200, 1500, 1550];
for (let y = 1600; y <= 2025; y += growth.step_years) envelopeYears.push(y);
envelopeYears.push(2026);
{
  const first = extents[0];
  const last = extents[extents.length - 1];
  if (first && last) {
    const kept = envelopeYears.filter((y) => y < first.year || y > last.year);
    envelopeYears.length = 0;
    envelopeYears.push(...[...new Set([...kept, ...extents.map((e) => e.year)])].sort((a, b) => a - b));
  }
}

/** Envelope geometry for one step: digitised where available, schematic otherwise. */
function envelopeAt(year: number): { poly: Poly; basis: GeometryBasis; source_ids: string[]; note: string } {
  const schematic = turf.polygon([envelopeRing(envelopeModel, year, 120)]) as Poly;
  const first = extents[0];
  const last = extents[extents.length - 1];
  if (!first || !last) return { poly: schematic, basis: "schematic", source_ids: [], note: "Schematic growth envelope (author-estimated)." };
  if (year < first.year) {
    return { poly: intersect(schematic, first.geometry) ?? schematic, basis: "schematic", source_ids: [], note: `Schematic envelope, kept within the digitised ${first.year} extent.` };
  }
  if (year > last.year) {
    const merged = (turf.union(turf.featureCollection([last.geometry, schematic])) as Poly | null) ?? last.geometry;
    return { poly: merged, basis: "schematic", source_ids: last.source_ids, note: `Digitised ${last.year} extent extended by the schematic envelope.` };
  }
  const current = [...extents].reverse().find((e) => e.year <= year) ?? first;
  return { poly: current.geometry, basis: "georeferenced", source_ids: current.source_ids, note: current.note || `Built-up extent digitised for ${current.year}.` };
}

const envelopeFeatures: Poly[] = [];
const footprint: { year: number; area_km2: number }[] = [];
for (let i = 0; i < envelopeYears.length; i += 1) {
  const year = envelopeYears[i] as number;
  const next = envelopeYears[i + 1] ?? PRESENT_SENTINEL;
  const step = envelopeAt(year);
  const clipped = subtract(step.poly, waterAt(year));
  if (!clipped) continue;
  const area = turf.area(clipped) / 1e6;
  footprint.push({ year, area_km2: round(area, 3) });
  envelopeFeatures.push({
    type: "Feature",
    geometry: turf.truncate(clipped, { precision: 6 }).geometry,
    properties: {
      feature_id: `envelope-${year}`, build_start: year, start_year: year, end_year: next, area_km2: round(area, 3),
      geometry_basis: step.basis, source_ids: step.source_ids.join(","), note: step.note,
    },
  });
}

// ── Streets ──────────────────────────────────────────────────────────────────
let osmLines: OsmLine[] = [];
if (existsSync(OSM_FILE)) {
  osmLines = readOsmLines(JSON.parse(readFileSync(OSM_FILE, { encoding: "utf-8" })));
  log.info(`Using OpenStreetMap geometry from data/osm/streets.geojson (${osmLines.length} ways).`);
}
let osmMatched = 0;

function splitLine(coords: LonLat[], segmentLength: number): LonLat[][] {
  const pieces: LonLat[][] = [];
  let current: LonLat[] = [coords[0] as LonLat];
  let acc = 0;
  for (let i = 1; i < coords.length; i += 1) {
    let a = coords[i - 1] as LonLat;
    const b = coords[i] as LonLat;
    let remaining = distance(a, b);
    while (acc + remaining > segmentLength) {
      const need = segmentLength - acc;
      const [dx, dy] = toLocal(a, b);
      const len = Math.hypot(dx, dy) || 1;
      const cut = offset(a, (dx / len) * need, (dy / len) * need);
      current.push(cut);
      pieces.push(current);
      current = [cut];
      a = cut;
      remaining -= need;
      acc = 0;
    }
    acc += remaining;
    current.push(b);
  }
  if (current.length > 1) pieces.push(current);
  return pieces;
}

const streetFeatures: object[] = [];
const streetsForMassing: StreetForMassing[] = [];
for (const s of streetsFile.streets) {
  const osm = osmLines.length ? matchStreet(osmLines, s.osm_names, s.coords) : null;
  if (osm) osmMatched += 1;
  const lines = osm ?? [s.coords];
  const basis: GeometryBasis = osm ? "surveyed" : "schematic";
  const documented = s.first_evidence !== null;
  if (documented) checkSources(s.first_evidence_source_ids, `Street ${s.id}`);
  const massingSegments: { coords: LonLat[]; appear: number }[] = [];
  let n = 0;
  for (const line of lines) {
    for (const piece of splitLine(line, STREET_SEGMENT_M)) {
      const mid = piece[Math.floor(piece.length / 2)] as LonLat;
      const inferred = growthYear(mid);
      const appear = documented ? (s.first_evidence as number) : Number.isFinite(inferred) ? round(inferred, 2) : 2026;
      massingSegments.push({ coords: piece, appear });
      const closures = (s.closures ?? []).sort((a, b) => a.from - b.from);
      const intervals: { from: number; to: number; closed: boolean }[] = [];
      let t = appear;
      for (const c of closures) {
        intervals.push({ from: t, to: c.from, closed: false }, { from: c.from, to: c.to, closed: true });
        t = c.to;
      }
      intervals.push({ from: t, to: PRESENT_SENTINEL, closed: false });
      for (const iv of intervals) {
        streetFeatures.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: roundRing(piece) },
          properties: {
            feature_id: `${s.id}-${n++}`, street_id: s.id, name: s.name, street_class: iv.closed ? "closed" : s.class,
            build_start: iv.from, start_year: iv.from, end_year: iv.to,
            date_basis: documented ? "documented" : "inferred", geometry_basis: basis,
            source_ids: (s.first_evidence_source_ids ?? []).join(","),
            note: documented ? s.first_evidence_note ?? "" : extents.length ? "Appearance inferred from the digitised built-up extents." : "Appearance inferred from the schematic growth envelope.",
            chapter: s.chapter ?? "", status: s.status ?? "",
          },
        });
      }
    }
  }
  streetsForMassing.push({ id: s.id, cls: s.class, segments: massingSegments });
}
if (osmLines.length) log.info(`Matched ${osmMatched}/${streetsFile.streets.length} streets to OpenStreetMap.`);

// ── Landmarks ────────────────────────────────────────────────────────────────
const landmarkFeatures: object[] = [];
const exclusions: { centre: LonLat; radius: number; from: number }[] = [];
for (const lm of landmarksIn) {
  const place = places.get(lm.place) as ResolvedPlace;
  const anchor: LonLat = [place.lon, place.lat];
  lm.phases.forEach((phase, phaseIndex) => {
    let maxExtent = 0;
    phase.parts.forEach((part, partIndex) => {
      let rings: Ring[];
      const dx = part.dx ?? 0;
      const dy = part.dy ?? 0;
      switch (part.shape) {
        case "rect":
          rings = [rectangle(anchor, part.w ?? 10, part.d ?? 10, lm.rot, dx, dy, part.rot ?? 0)];
          maxExtent = Math.max(maxExtent, Math.hypot(dx, dy) + Math.max(part.w ?? 0, part.d ?? 0) / 2);
          break;
        case "court":
          rings = courtyard(anchor, part.w ?? 40, part.d ?? 40, part.t ?? 8, lm.rot, dx, dy);
          maxExtent = Math.max(maxExtent, Math.hypot(dx, dy) + Math.max(part.w ?? 0, part.d ?? 0) / 2);
          break;
        case "circle":
          rings = [circle(anchor, part.r ?? 5, 40, lm.rot, dx, dy)];
          maxExtent = Math.max(maxExtent, Math.hypot(dx, dy) + (part.r ?? 0));
          break;
        case "deck":
          rings = [corridor(part.path ?? [], part.width ?? 6)];
          break;
        default:
          throw new Error(`Landmark ${lm.id}: unknown part shape`);
      }
      landmarkFeatures.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: rings.map(roundRing) },
        properties: {
          feature_id: `${lm.id}-${phaseIndex}-${partIndex}`, landmark_id: lm.id, name: lm.name, phase: phaseIndex, part: partIndex,
          build_start: phase.build_start, start_year: phase.start, end_year: phase.end ?? PRESENT_SENTINEL,
          base_m: part.base ?? 0, height_m: part.h, style: phase.style, status: lm.status,
          historical_confidence: lm.confidence, height_basis: lm.height_basis, footprint_basis: lm.footprint_basis,
          positional_uncertainty_m: place.uncertainty_m, source_ids: lm.source_ids.join(","), notes: lm.notes ?? "",
        },
      });
    });
    if (maxExtent > 0) exclusions.push({ centre: anchor, radius: maxExtent + 6, from: phase.build_start });
  });
}
// Open spaces kept clear of illustrative massing once they exist.
exclusions.push(
  { centre: [-5.93000, 54.59639], radius: 85, from: 1783 }, // Donegall Square / City Hall grounds
  { centre: [-5.93495, 54.60753], radius: 70, from: 1795 }, // New Burying Ground
  { centre: [-5.92490, 54.60024], radius: 28, from: 1300 }, // churchyard, High Street
  { centre: [-5.93400, 54.58250], radius: 220, from: 1828 }, // Botanic Gardens (approximate)
);

// ── Rail ─────────────────────────────────────────────────────────────────────
const railFeatures = transport.lines.map((l) => {
  checkSources(l.source_ids, `Rail ${l.id}`);
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: l.coords },
    properties: { feature_id: l.id, name: l.name, kind: l.kind, build_start: Math.floor(l.start) - 2, start_year: l.start, end_year: l.end ?? PRESENT_SENTINEL, geometry_basis: l.geometry_basis, historical_confidence: l.confidence, source_ids: l.source_ids.join(","), note: l.note, length_m: Math.round(polylineLength(l.coords)) },
  };
});

// ── Massing ──────────────────────────────────────────────────────────────────
const [handoverStart, handoverEnd] = growth.massing.fade_to_modern;
if (!(handoverEnd > handoverStart)) fail("growth.json: fade_to_modern must be [start, end] with end after start");
if (handoverStart <= LAST_GENERATED_YEAR) fail(`growth.json: fade_to_modern must start after ${LAST_GENERATED_YEAR}, the last year in which illustrative blocks appear`);
const redevelopment = growth.massing.redevelopment;
if (redevelopment) {
  checkSources(redevelopment.source_ids, "Massing redevelopment");
  if (!(redevelopment.share >= 0 && redevelopment.share <= 1)) fail("growth.json: redevelopment.share must be between 0 and 1");
  const [g0, g1] = redevelopment.gap_years;
  if (!(g0 >= 1 && g1 >= g0)) fail("growth.json: redevelopment.gap_years must be [min, max] with min of at least 1 year");
  if (!growth.styles.redevelopment) fail('growth.json: add a "redevelopment" style so rebuilt blocks are labelled as such');
}
const yards: YardZone[] = [];
for (const y of growth.massing.yards ?? []) {
  checkSources(y.source_ids, `Yard ${y.id}`);
  const land = lands.find((l) => l.id === y.land);
  if (!land) {
    fail(`Yard ${y.id}: unknown land id "${y.land}"`);
    continue;
  }
  if (!(y.full_by > y.from)) fail(`Yard ${y.id}: full_by must be after from`);
  if (!pointInRing(y.seed_point, closeRing(land.coords))) fail(`Yard ${y.id}: seed_point must lie inside land "${y.land}"`);
  yards.push({ ...y, ring: closeRing(land.coords) });
}

const massing = generateMassing({
  yards,
  streets: streetsForMassing,
  envelope: envelopeModel,
  growthYear,
  landYear,
  exclusions,
  params: growth.massing,
  styles: growth.styles,
  seed: growth.seed,
});
log.info(`Generated ${massing.length} illustrative massing features.`);
// Every block is loaded once and time is a filter, so the whole layer must fit the 3D view's cap.
if (massing.length > MASSING_FEATURE_CAP) fail(`Massing has ${massing.length} blocks, more than the layer-view cap of ${MASSING_FEATURE_CAP}: lower massing.max_features or redevelopment.share`);
// A block must be complete before blocks start handing over, or it would appear during the handover.
const massingLastComplete = massing.reduce((m, f) => Math.max(m, f.properties.s), -Infinity);
const [retireFrom] = retireRange(growth.massing.fade_to_modern);
if (massingLastComplete >= retireFrom) fail(`Massing blocks complete up to ${massingLastComplete}, after the handover begins retiring blocks (${retireFrom.toFixed(2)}): move fade_to_modern later`);
for (const f of massing) if (!(f.properties.r > f.properties.s)) fail(`Massing block ${f.properties.i} hands over (${f.properties.r}) before it is complete (${f.properties.s})`);

// ── Event points and uncertainty discs ───────────────────────────────────────
const eventPoints = events
  .filter((e) => e.longitude !== null && e.latitude !== null)
  .map((e) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [e.longitude, e.latitude] },
    properties: {
      event_id: e.event_id, title: e.title, start_year: e.start_year, end_year: e.end_year,
      importance: e.timeline_importance, confidence: e.historical_confidence, category: e.event_category,
      chapter: e.chapter ?? "", precision_m: e.location_uncertainty_m ?? 0, place_id: e.place_id ?? "",
    },
  }));

const discs = [...places.values()]
  .filter((p) => p.uncertainty_m >= 20)
  .map((p) => ({
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [roundRing(circle([p.lon, p.lat], p.uncertainty_m, 48))] },
    properties: { place_id: p.id, name: p.name, uncertainty_m: p.uncertainty_m, basis: p.basis },
  }));

// ── Trail ────────────────────────────────────────────────────────────────────
const trail = {
  ...trailIn,
  stops: trailIn.stops.map((s) => {
    const place = places.get(s.place) as ResolvedPlace;
    return { ...s, longitude: place.lon, latitude: place.lat, uncertainty_m: place.uncertainty_m };
  }),
};

// ── Illustrative 1791 plan (SVG) ─────────────────────────────────────────────
function buildIllustrativePlan(year: number): string {
  const overlay = overlaysIn.overlays.find((o) => o.id === "illustrative-plan-1791");
  const ext = overlay?.georeference ?? { xmin: -5.94, ymin: 54.593, xmax: -5.915, ymax: 54.61 };
  const widthM = distance([ext.xmin, ext.ymin], [ext.xmax, ext.ymin]);
  const heightM = distance([ext.xmin, ext.ymin], [ext.xmin, ext.ymax]);
  const W = 2000;
  const H = Math.round((W * heightM) / widthM);
  const px = ([lon, lat]: LonLat): string =>
    `${(((lon - ext.xmin) / (ext.xmax - ext.xmin)) * W).toFixed(1)},${(((ext.ymax - lat) / (ext.ymax - ext.ymin)) * H).toFixed(1)}`;
  const path = (rings: LonLat[][], close = true): string => rings.map((r) => `M${r.map(px).join("L")}${close ? "Z" : ""}`).join("");
  const polyRings = (g: Polygon | MultiPolygon): LonLat[][] =>
    g.type === "Polygon" ? (g.coordinates as LonLat[][]) : (g.coordinates as LonLat[][][]).flat();

  const water = waterAt(year);
  const envelopeAtYear = envelopeFeatures.filter((f) => (f.properties as { start_year: number; end_year: number }).start_year <= year && year < (f.properties as { end_year: number }).end_year);
  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#efe3c6"/>`);
  parts.push(`<rect width="${W}" height="${H}" fill="url(#grain)" opacity="0.35"/>`);
  for (const f of envelopeAtYear) parts.push(`<path d="${path(polyRings(f.geometry))}" fill="#e2cfa3" stroke="#a6875a" stroke-width="2" stroke-dasharray="10 6" fill-rule="evenodd"/>`);
  parts.push(`<path d="${path(polyRings(water.geometry))}" fill="#a9bdb6" stroke="#6f8c86" stroke-width="2" fill-rule="evenodd"/>`);
  for (const m of massing) {
    const p = m.properties;
    if (p.b <= year && year < p.e) parts.push(`<path d="${path(m.geometry.coordinates as LonLat[][])}" fill="#8c6a48" opacity="0.72"/>`);
  }
  for (const f of landmarkFeatures as { geometry: Polygon; properties: { build_start: number; end_year: number; base_m: number } }[]) {
    const p = f.properties;
    if (p.build_start <= year && year < p.end_year && p.base_m === 0) parts.push(`<path d="${path(f.geometry.coordinates as LonLat[][])}" fill="#5b3a24" fill-rule="evenodd"/>`);
  }
  for (const f of streetFeatures as { geometry: { coordinates: LonLat[] }; properties: { start_year: number; end_year: number; street_class: string } }[]) {
    const p = f.properties;
    if (p.start_year <= year && year < p.end_year && p.street_class !== "motorway") {
      const w = p.street_class === "entry" ? 2 : 5;
      parts.push(`<path d="${path([f.geometry.coordinates], false)}" fill="none" stroke="#3b2a1c" stroke-width="${w}" stroke-linecap="round" opacity="0.8"/>`);
    }
  }
  const label = (text: string, at: LonLat, size = 26, rotate = 0): string => {
    const [x, y] = px(at).split(",");
    return `<text x="${x}" y="${y}" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="${size}" fill="#3b2a1c" text-anchor="middle" transform="rotate(${rotate} ${x} ${y})">${text}</text>`;
  };
  parts.push(label("HIGH STREET", [-5.9262, 54.6003], 24, -12));
  parts.push(label("Waring Street", [-5.9258, 54.6013], 20, -6));
  parts.push(label("Ann Street", [-5.9262, 54.5990], 20, -6));
  parts.push(label("Donegall Street", [-5.9300, 54.6038], 20, -48));
  parts.push(label("Donegall Place", [-5.9314, 54.5985], 20, -90));
  parts.push(label("Linen Hall", [-5.9300, 54.5957], 22, 0));
  parts.push(label("River Lagan", [-5.9182, 54.5960], 30, -80));
  parts.push(label("Poor House", [-5.9333, 54.6072], 20, 0));
  // Cartouche, north arrow and scale bar.
  const scaleM = 200;
  const scalePx = (scaleM / widthM) * W;
  parts.push(`<g transform="translate(60 ${H - 230})"><rect width="720" height="190" fill="#f5ecd6" stroke="#5b3a24" stroke-width="3"/><rect x="8" y="8" width="704" height="174" fill="none" stroke="#5b3a24" stroke-width="1"/>` +
    `<text x="360" y="58" font-family="Georgia, serif" font-size="40" text-anchor="middle" fill="#3b2a1c">Belfast c. 1791</text>` +
    `<text x="360" y="100" font-family="Georgia, serif" font-style="italic" font-size="22" text-anchor="middle" fill="#3b2a1c">An illustrative plan generated from the Belfast Rising model</text>` +
    `<text x="360" y="138" font-family="Georgia, serif" font-size="20" text-anchor="middle" fill="#7a2e1f">NOT A HISTORIC MAP — schematic streets, envelope and massing</text>` +
    `<text x="360" y="168" font-family="Georgia, serif" font-size="16" text-anchor="middle" fill="#3b2a1c">Consult IHTA Belfast Part I and OSNI six-inch editions for surveyed evidence</text></g>`);
  parts.push(`<g transform="translate(${W - 140} 150)"><path d="M0,-90 L22,20 L0,6 L-22,20 Z" fill="#3b2a1c"/><text y="-104" font-family="Georgia, serif" font-size="34" text-anchor="middle" fill="#3b2a1c">N</text></g>`);
  parts.push(`<g transform="translate(${W - 120 - scalePx} ${H - 70})"><rect width="${scalePx.toFixed(1)}" height="12" fill="#3b2a1c"/><rect width="${(scalePx / 2).toFixed(1)}" height="12" fill="#f5ecd6" stroke="#3b2a1c"/><text x="${(scalePx / 2).toFixed(1)}" y="44" font-family="Georgia, serif" font-size="22" text-anchor="middle" fill="#3b2a1c">${scaleM} metres</text></g>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs><filter id="noise"><feTurbulence baseFrequency="0.9" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 0.35 0 0 0 0 0.25 0 0 0 0 0.15 0 0 0 0.35 0"/></filter>` +
    `<pattern id="grain" width="${W}" height="${H}" patternUnits="userSpaceOnUse"><rect width="${W}" height="${H}" filter="url(#noise)"/></pattern></defs>${parts.join("")}</svg>\n`;
}
writeFileSync(resolve(MAPS_OUT, "illustrative-plan-1791.svg"), buildIllustrativePlan(1791), { encoding: "utf-8" });

// ── Write outputs ────────────────────────────────────────────────────────────
const fc = (features: object[]) => ({ type: "FeatureCollection", features });
writeJson("sources.json", [...sources.values()]);
writeJson("places.json", [...places.values()].map(({ lonlat: _l, irish_grid: _g, itm: _i, ...rest }) => rest));
writeJson("events.json", events);
writeJson("events.geojson", fc(eventPoints));
writeJson("uncertainty.geojson", fc(discs));
writeJson("landmarks.geojson", fc(landmarkFeatures));
writeJson("streets.geojson", fc(streetFeatures));
writeJson("water.geojson", fc(waterFeatures));
writeJson("land.geojson", fc(landFeatures));
writeJson("envelope.geojson", fc(envelopeFeatures));
writeJson("rail.geojson", fc(railFeatures));
writeJson("massing.geojson", fc(massing));
writeJson("trail.json", trail);
writeJson("tours.json", readJson("tours.json"));
writeJson("overlays.json", readJson("historic-maps.json"));

const styleIds = Object.keys(growth.styles);
writeJson("manifest.json", {
  generated: new Date().toISOString().slice(0, 10),
  counts: {
    sources: sources.size, places: places.size, events: events.length, mapped_events: eventPoints.length,
    landmark_parts: landmarkFeatures.length, street_segments: streetFeatures.length, massing: massing.length,
    envelope_steps: envelopeFeatures.length, eras: ERAS.length,
  },
  styles: styleIds.map((id, code) => ({ code, id, label: growth.styles[id]?.label ?? id })),
  fade_to_modern: growth.massing.fade_to_modern,
  /** Latest completion year of any massing block: after it, no block is under construction. */
  massing_last_complete: massingLastComplete,
  phases: {
    clearance: growth.massing.clearance_years,
    redevelopment: redevelopment ? [growth.massing.clearance_years[0], LAST_GENERATED_YEAR] : null,
    handover: growth.massing.fade_to_modern,
    handover_field: "r",
  },
  footprint,
  population: { series: population.series, alternates: population.alternates, source_ids: population.source_ids },
  street_geometry_source: osmMatched > 0 ? "openstreetmap" : "schematic",
  extent_source: extents.length ? "digitised" : "schematic",
  extent_years: extents.map((e) => e.year),
  lost_entries: streetsFile.lost_entries,
});

if (errors.length > 0) {
  console.error(`[data] ${errors.length} error(s) during build:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
log.info(`Wrote ${OUT}`);
