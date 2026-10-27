/**
 * Illustrative massing generator.
 *
 * Produces placeholder building volumes that show *how* Belfast grew —
 * outward along its streets and upward through successive rebuilds — not
 * *what* stood where. Every feature is flagged illustrative in the app.
 *
 * Two families are generated:
 *  - frontage blocks along the period street network, appearing when their
 *    street segment appears, and rebuilt taller over time in the core;
 *  - terrace rows filling the growth envelope beyond the core, with a share
 *    of inner-ring rows cleared in the 1960s–80s redevelopment period and,
 *    on most cleared sites, a redevelopment block (flats and maisonettes,
 *    later low-rise housing) after a few vacant years — so clearance reads as
 *    redevelopment rather than as the inner city emptying.
 *
 * Every block also carries a handover year `r`: during the handover to the
 * present-day buildings the scene removes blocks by filter (centre first)
 * instead of fading the whole layer (see src/engine/handover.ts).
 *
 * Generation is deterministic for a given seed.
 */
import {
  distance,
  distanceToPolyline,
  offset,
  pointInRing,
  rectangle,
  toLocal,
  type LonLat,
  type Ring,
} from "../../src/engine/geo";
import { envelopeYearAt, seededRandom, type EnvelopeModel } from "../../src/engine/envelope";
import { handoverYear } from "../../src/engine/handover";
import { PRESENT_SENTINEL } from "../../src/engine/time";

export interface StyleDef {
  label: string;
  from: number;
  height: [number, number];
}

export interface MassingParams {
  frontage_spacing_m: [number, number];
  frontage_depth_m: [number, number];
  frontage_offset_m: number;
  terrace_length_m: [number, number];
  terrace_depth_m: number;
  terrace_row_spacing_m: { until_m: number; step: number }[];
  terrace_max_year: number;
  core_radius_m: number;
  replacement_radius_m: number;
  clearance_ring_m: [number, number];
  clearance_share: number;
  clearance_years: [number, number];
  fade_to_modern: [number, number];
  max_features: number;
  /** Rebuilding on cleared terrace sites (omit to leave cleared sites vacant). */
  redevelopment?: RedevelopmentParams;
}

/**
 * Redevelopment of cleared terrace sites. The share, gap and forms are
 * illustrative; the fact of clearance followed by redevelopment is sourced.
 */
export interface RedevelopmentParams {
  /** Share of cleared rows rebuilt (0–1). */
  share: number;
  /** Vacant years between clearance and the new block. */
  gap_years: [number, number];
  /** Blocks begun before this year are flats/maisonettes; later ones low-rise housing. */
  flats_until: number;
  source_ids?: string[];
  note?: string;
}

/**
 * An industrial zone (a shipyard, say) filled with large sheds that spread out
 * from `seed_point` between `from` and `full_by`. Positions, sizes and dates
 * of individual sheds are illustrative; the zone's dates must be sourced.
 */
export interface YardZone {
  id: string;
  ring: Ring;
  from: number;
  full_by: number;
  seed_point: LonLat;
  /** Long axis of the sheds, degrees counter-clockwise from east. */
  rotation_deg: number;
  step_along_m: number;
  step_across_m: number;
  shed_length_m: [number, number];
  shed_depth_m: [number, number];
  height_m: [number, number];
  /** Range of years in which non-surviving sheds are cleared. */
  end_years: [number, number];
  /** Share of sheds that survive to the present. */
  surviving_share: number;
}

export interface StreetForMassing {
  id: string;
  cls: string;
  segments: { coords: LonLat[]; appear: number }[];
}

export interface Exclusion {
  centre: LonLat;
  radius: number;
  from: number;
}

export interface MassingInputs {
  streets: StreetForMassing[];
  envelope: EnvelopeModel;
  /**
   * First year a point lies inside the built-up extent. Defaults to the
   * schematic envelope; the build passes digitised extents when supplied.
   */
  growthYear?: (p: LonLat) => number;
  /** Optional industrial zones such as shipyards. */
  yards?: YardZone[];
  /** Year a point becomes dry land: -Infinity = always, Infinity = never. */
  landYear: (p: LonLat) => number;
  exclusions: Exclusion[];
  params: MassingParams;
  styles: Record<string, StyleDef>;
  seed: number;
}

export interface MassingFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: Ring[] };
  /** i id, b build start, s complete, e removed, h height, k style code, t kind, r handover year. */
  properties: { i: number; b: number; s: number; e: number; h: number; k: number; t: number; r: number };
}

/** Latest year at which illustrative massing is generated (the modern layer takes over). */
export const LAST_GENERATED_YEAR = 1985;
/** Kinds encoded in property t. */
export const KIND_FRONTAGE = 0;
export const KIND_TERRACE = 1;
export const KIND_INDUSTRIAL = 2;
export const KIND_REDEVELOPMENT = 3;
/** Seed offsets for independent random streams (so adding one never reshuffles the others). */
const REDEVELOPMENT_SEED_OFFSET = 7919;
const HANDOVER_SEED_OFFSET = 104729;
/** Infill rows start this far from the centre (inside it the street frontages suffice). */
const CORE_INFILL_START_M = 40;

export function styleOrder(styles: Record<string, StyleDef>): string[] {
  return Object.keys(styles);
}

/** Architectural style for a building completed in `year`. */
export function styleForYear(year: number, family: "frontage" | "terrace"): string {
  if (year < 1613) return "medieval";
  if (year < 1700) return "plantation";
  if (year < 1800) return "georgian";
  if (year < 1840) return "regency";
  if (family === "terrace") {
    if (year < 1921) return "terrace";
    if (year < 1945) return "interwar";
    return "postwar";
  }
  if (year < 1900) return "victorian";
  if (year < 1921) return "edwardian";
  if (year < 1945) return "interwar";
  return "postwar";
}

function between(rand: () => number, [a, b]: [number, number]): number {
  return a + rand() * (b - a);
}

function excluded(p: LonLat, year: number, exclusions: Exclusion[]): boolean {
  return exclusions.some((x) => year >= x.from - 5 && distance(p, x.centre) < x.radius);
}

/**
 * Uniform-grid index of street segments so proximity tests stay roughly
 * O(1) per query instead of O(segments).
 */
export class SegmentIndex {
  private readonly cells = new Map<string, { id: string; line: LonLat[] }[]>();

  constructor(
    streets: StreetForMassing[],
    private readonly origin: LonLat,
    private readonly cellSize = 80,
  ) {
    for (const street of streets) {
      for (const seg of street.segments) {
        for (let i = 0; i < seg.coords.length - 1; i += 1) {
          const a = seg.coords[i] as LonLat;
          const b = seg.coords[i + 1] as LonLat;
          const line = [a, b];
          const [ax, ay] = toLocal(origin, a);
          const [bx, by] = toLocal(origin, b);
          const x0 = Math.floor(Math.min(ax, bx) / cellSize);
          const x1 = Math.floor(Math.max(ax, bx) / cellSize);
          const y0 = Math.floor(Math.min(ay, by) / cellSize);
          const y1 = Math.floor(Math.max(ay, by) / cellSize);
          for (let x = x0; x <= x1; x += 1) {
            for (let y = y0; y <= y1; y += 1) {
              const key = `${x}:${y}`;
              const bucket = this.cells.get(key) ?? [];
              bucket.push({ id: street.id, line });
              this.cells.set(key, bucket);
            }
          }
        }
      }
    }
  }

  /**
   * Direction (degrees counter-clockwise from east) of the nearest street
   * segment within `maxDistance` metres, or null if none is that close.
   */
  nearestAngle(p: LonLat, maxDistance: number): number | null {
    const [px, py] = toLocal(this.origin, p);
    const reach = Math.ceil(maxDistance / this.cellSize);
    const cx = Math.floor(px / this.cellSize);
    const cy = Math.floor(py / this.cellSize);
    let best = maxDistance;
    let angle: number | null = null;
    for (let x = cx - reach; x <= cx + reach; x += 1) {
      for (let y = cy - reach; y <= cy + reach; y += 1) {
        const bucket = this.cells.get(`${x}:${y}`);
        if (!bucket) continue;
        for (const item of bucket) {
          const d = distanceToPolyline(p, item.line);
          if (d < best) {
            best = d;
            const [vx, vy] = toLocal(item.line[0] as LonLat, item.line[1] as LonLat);
            angle = (Math.atan2(vy, vx) * 180) / Math.PI;
          }
        }
      }
    }
    return angle;
  }

  /** True when a segment of another street lies within `tolerance` metres. */
  near(p: LonLat, tolerance: number, ownId = ""): boolean {
    const [px, py] = toLocal(this.origin, p);
    const reach = Math.ceil(tolerance / this.cellSize);
    const cx = Math.floor(px / this.cellSize);
    const cy = Math.floor(py / this.cellSize);
    for (let x = cx - reach; x <= cx + reach; x += 1) {
      for (let y = cy - reach; y <= cy + reach; y += 1) {
        const bucket = this.cells.get(`${x}:${y}`);
        if (!bucket) continue;
        for (const item of bucket) {
          if (item.id === ownId) continue;
          if (distanceToPolyline(p, item.line) < tolerance) return true;
        }
      }
    }
    return false;
  }
}

/** Generate illustrative massing features. */
export function generateMassing(input: MassingInputs): MassingFeature[] {
  const { params, styles, envelope } = input;
  const order = styleOrder(styles);
  const code = (style: string): number => Math.max(0, order.indexOf(style));
  const rand = seededRandom(input.seed);
  // Separate streams: redevelopment and handover draws never shift the main layout.
  const redevRand = seededRandom(input.seed + REDEVELOPMENT_SEED_OFFSET);
  const handoverRand = seededRandom(input.seed + HANDOVER_SEED_OFFSET);
  const index = new SegmentIndex(input.streets, envelope.centre);
  const growthYear = input.growthYear ?? ((p: LonLat) => envelopeYearAt(envelope, p));
  const features: MassingFeature[] = [];
  let nextId = 1;

  const push = (ring: Ring, build: number, start: number, end: number, height: number, style: string, kind: number) => {
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring.map(([x, y]) => [round6(x), round6(y)] as LonLat)] },
      properties: {
        i: nextId++,
        b: round2(build),
        s: round2(start),
        e: round2(end),
        h: round1(height),
        k: code(style),
        t: kind,
        r: PRESENT_SENTINEL,
      },
    });
  };

  const heightFor = (style: string, core: boolean): number => {
    const def = styles[style];
    if (!def) return 8;
    const [lo, hi] = def.height;
    return core ? between(rand, [lo + (hi - lo) * 0.4, hi]) : between(rand, [lo, lo + (hi - lo) * 0.7]);
  };

  /** Push a building and its successive rebuilds (the core grows upward). */
  const pushPhased = (ring: Ring, appear: number, dist: number, core: boolean): void => {
    let start = appear;
    let previousHeight = 0;
    for (let phase = 0; phase < 3; phase += 1) {
      const style = styleForYear(start, "frontage");
      const h = Math.max(previousHeight + 1.5, heightFor(style, core));
      const replaceAfter = between(rand, [70, 120]);
      const canReplace = dist < params.replacement_radius_m && start + replaceAfter < LAST_GENERATED_YEAR;
      const end = canReplace ? start + replaceAfter : PRESENT_SENTINEL;
      push(ring, start - between(rand, [0.6, 2.2]), start, end, h, style, KIND_FRONTAGE);
      if (!canReplace) break;
      previousHeight = h;
      start = end + between(rand, [0.4, 2]);
    }
  };

  // ── Frontage blocks along streets ─────────────────────────────────────────
  for (const street of input.streets) {
    if (street.cls === "entry" || street.cls === "motorway") continue;
    for (const seg of street.segments) {
      const coords = seg.coords;
      for (let i = 0; i < coords.length - 1; i += 1) {
        const a = coords[i] as LonLat;
        const b = coords[i + 1] as LonLat;
        const [vx, vy] = toLocal(a, b);
        const len = Math.hypot(vx, vy);
        if (len < 6) continue;
        const ux = vx / len;
        const uy = vy / len;
        const rotation = (Math.atan2(uy, ux) * 180) / Math.PI;
        let along = between(rand, [2, 8]);
        while (along < len - 4) {
          const spacing = between(rand, params.frontage_spacing_m);
          const depth = between(rand, params.frontage_depth_m);
          const mid = along + spacing / 2;
          for (const side of [1, -1]) {
            const off = side * (params.frontage_offset_m + depth / 2);
            const centre = offset(a, ux * mid - uy * off, uy * mid + ux * off);
            const envelopeYear = growthYear(centre);
            const land = input.landYear(centre);
            if (!Number.isFinite(land) && land > 0) continue;
            let appear = Math.max(seg.appear, Number.isFinite(envelopeYear) ? envelopeYear : seg.appear, land);
            appear += between(rand, [0, 7]);
            if (appear > LAST_GENERATED_YEAR) continue;
            if (excluded(centre, appear, input.exclusions)) continue;
            if (index.near(centre, params.frontage_offset_m * 0.8, street.id)) continue;
            const dist = distance(centre, envelope.centre);
            const core = dist < params.core_radius_m;
            pushPhased(rectangle(centre, spacing * 0.92, depth, rotation), appear, dist, core);
          }
          along += spacing;
        }
      }
    }
  }

  // ── Industrial zones (shipyards) ──────────────────────────────────────────
  for (const yard of input.yards ?? []) {
    const theta = (yard.rotation_deg * Math.PI) / 180;
    const local = yard.ring.map((p) => toLocal(yard.seed_point, p));
    const reach = Math.max(...local.map(([x, y]) => Math.hypot(x, y)));
    const spanU = Math.ceil(reach / yard.step_along_m);
    const spanV = Math.ceil(reach / yard.step_across_m);
    for (let u = -spanU; u <= spanU; u += 1) {
      for (let v = -spanV; v <= spanV; v += 1) {
        const a = u * yard.step_along_m;
        const b = v * yard.step_across_m;
        const x = a * Math.cos(theta) - b * Math.sin(theta);
        const y = a * Math.sin(theta) + b * Math.cos(theta);
        const centre = offset(yard.seed_point, x, y);
        if (!pointInRing(centre, yard.ring)) continue;
        const land = input.landYear(centre);
        if (land === Infinity) continue;
        if (rand() < 0.16) continue; // berths, yards and open ground
        const spread = Math.min(1, Math.hypot(x, y) / Math.max(1, reach));
        const appear = Math.max(land + 2, yard.from + (yard.full_by - yard.from) * spread + between(rand, [0, 4]));
        if (excluded(centre, appear, input.exclusions)) continue;
        const end = rand() < yard.surviving_share ? PRESENT_SENTINEL : between(rand, yard.end_years);
        if (end <= appear) continue;
        const ring = rectangle(centre, between(rand, yard.shed_length_m), between(rand, yard.shed_depth_m), yard.rotation_deg);
        push(ring, appear - between(rand, [0.8, 2]), appear, end, between(rand, yard.height_m), "industrial", KIND_INDUSTRIAL);
      }
    }
  }

  // ── Terrace rows and mills filling the envelope ───────────────────────────
  // Candidates are groups so a cleared row and its redevelopment are thinned together.
  const terraceCandidates: MassingFeature[][] = [];
  const redev = params.redevelopment;
  const redevStyle = styles.redevelopment ? "redevelopment" : "postwar";
  const bands = params.terrace_row_spacing_m;
  let inner = CORE_INFILL_START_M;
  for (const band of bands) {
    const outer = band.until_m;
    const step = band.step;
    const span = Math.ceil(outer / step);
    for (let gx = -span; gx <= span; gx += 1) {
      for (let gy = -span; gy <= span; gy += 1) {
        const x = gx * step + between(rand, [-0.22, 0.22]) * step;
        const y = gy * step + between(rand, [-0.22, 0.22]) * step;
        const r = Math.hypot(x, y);
        if (r < inner || r >= outer) continue;
        const centre = offset(envelope.centre, x, y);
        const envelopeYear = growthYear(centre);
        if (!Number.isFinite(envelopeYear) || envelopeYear > params.terrace_max_year) continue;
        const land = input.landYear(centre);
        if (land === Infinity) continue;
        const appear = Math.max(envelopeYear, land) + between(rand, [0, 9]);
        if (appear > Math.min(params.terrace_max_year, LAST_GENERATED_YEAR)) continue;
        if (excluded(centre, appear, input.exclusions)) continue;
        if (index.near(centre, 16)) continue;
        // Align with the local street pattern: courts follow the nearest
        // street; terraces run off the nearest main road as side streets.
        const roadAngle = index.nearestAngle(centre, r < params.core_radius_m ? 120 : 320);
        // Without a nearby road, rows within each 30° sector run parallel,
        // giving district-like street grids rather than concentric rings.
        const sectorBearing = Math.round((Math.atan2(x, y) * 180) / Math.PI / 30) * 30;
        const tangent = -sectorBearing + between(rand, [-4, 4]);
        if (r < params.core_radius_m) {
          if (rand() < 0.18) continue; // yards and gardens

          const angle = roadAngle ?? tangent;
          pushPhased(rectangle(centre, between(rand, [24, 40]), between(rand, [14, 21]), angle), appear, r, true);
          continue;
        }
        const angle = roadAngle === null ? tangent : roadAngle + 90;
        const industrial = r > 900 && r < 3600 && appear > 1830 && appear < 1914 && rand() < 0.07;
        if (industrial) {
          const w = between(rand, [50, 85]);
          const d = between(rand, [18, 26]);
          const end = rand() < 0.5 ? between(rand, [1958, 1995]) : PRESENT_SENTINEL;
          terraceCandidates.push([makeFeature(rectangle(centre, w, d, angle), appear - 2, appear, end, between(rand, styles.industrial?.height ?? [16, 24]), code("industrial"), KIND_INDUSTRIAL)]);
          continue;
        }
        const style = styleForYear(appear, "terrace");
        const h = heightFor(style, false);
        const [c0, c1] = params.clearance_ring_m;
        const cleared = r > c0 && r < c1 && appear < 1914 && rand() < params.clearance_share;
        const end = cleared ? between(rand, params.clearance_years) : PRESENT_SENTINEL;
        const length = Math.min(between(rand, params.terrace_length_m), step * 1.25);
        const depth = Math.min(params.terrace_depth_m, step * 0.55);
        const group = [makeFeature(rectangle(centre, length, depth, angle), appear - between(rand, [0.5, 1.5]), appear, end, h, code(style), KIND_TERRACE)];
        if (cleared && redev) {
          const successor = redevelopmentBlock(redevRand, redev, centre, length, depth, angle, end, styles[redevStyle], code(redevStyle));
          if (successor) group.push(successor);
        }
        terraceCandidates.push(group);
      }
    }
    inner = outer;
  }

  // Thin terraces uniformly if the total would exceed the feature budget,
  // keeping each cleared row together with its redevelopment.
  const budget = Math.max(0, params.max_features - features.length);
  const total = terraceCandidates.reduce((n, g) => n + g.length, 0);
  const keepEvery = total > budget && budget > 0 ? total / budget : 1;
  let cursor = 0;
  let seen = 0;
  let kept = 0;
  for (const group of terraceCandidates) {
    if (seen >= cursor && kept + group.length <= budget) {
      for (const f of group) {
        f.properties.i = nextId++;
        features.push(f);
      }
      kept += group.length;
      cursor += keepEvery * group.length;
    }
    seen += group.length;
  }

  // ── Handover years: centre first, soft-edged (see src/engine/handover.ts) ──
  const reach = Math.max(1, ...envelope.benchmarks.flatMap((m) => m.radii));
  for (const f of features) {
    const ring = f.geometry.coordinates[0] as LonLat[];
    const n = Math.max(1, ring.length - 1);
    let x = 0;
    let y = 0;
    for (let k = 0; k < n; k += 1) {
      x += (ring[k] as LonLat)[0];
      y += (ring[k] as LonLat)[1];
    }
    const share = distance([x / n, y / n], envelope.centre) / reach;
    f.properties.r = handoverYear(params.fade_to_modern, share, handoverRand());
  }
  return features;
}

/**
 * Redevelopment block on a cleared terrace site, or null when the site would
 * only be rebuilt after the handover (it then stays vacant in the model).
 * Earlier schemes are taller flats and maisonettes on a narrower footprint;
 * later ones low-rise housing — both illustrative forms.
 */
function redevelopmentBlock(
  rand: () => number,
  params: RedevelopmentParams,
  centre: LonLat,
  length: number,
  depth: number,
  angle: number,
  clearedIn: number,
  style: StyleDef | undefined,
  k: number,
): MassingFeature | null {
  if (rand() >= params.share) return null;
  const appear = Math.min(clearedIn + between(rand, params.gap_years), LAST_GENERATED_YEAR);
  if (appear < clearedIn + 1) return null;
  const [lo, hi] = style?.height ?? [10, 30];
  const flats = appear < params.flats_until;
  const height = flats ? between(rand, [lo + (hi - lo) * 0.35, hi]) : between(rand, [lo, lo + (hi - lo) * 0.2]);
  const blockLength = length * between(rand, flats ? [0.75, 1] : [0.85, 1]);
  const blockDepth = flats ? Math.min(depth, between(rand, [11, 15])) : depth;
  // Building starts no earlier than the clearance: the two never stand on the site together.
  const build = Math.max(clearedIn, appear - between(rand, [1, 2.5]));
  return makeFeature(rectangle(centre, blockLength, blockDepth, angle), build, appear, PRESENT_SENTINEL, height, k, KIND_REDEVELOPMENT);
}

function makeFeature(ring: Ring, build: number, start: number, end: number, height: number, k: number, t: number): MassingFeature {
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring.map(([x, y]) => [round6(x), round6(y)] as LonLat)] },
    properties: { i: 0, b: round2(build), s: round2(start), e: round2(end), h: round1(height), k, t, r: PRESENT_SENTINEL },
  };
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
