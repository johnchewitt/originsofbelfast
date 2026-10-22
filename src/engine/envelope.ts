/**
 * Schematic growth envelope.
 *
 * A deliberately simple, transparent model of built-up extent: radii in
 * eight compass directions at benchmark years, interpolated linearly in time
 * and smoothly in angle, with a fixed low-amplitude wobble so outlines look
 * organic. It sequences the illustrative massing; it is not digitised from
 * historical maps.
 */
import { offset, toLocal, type LonLat, type Ring } from "./geo";

export interface EnvelopeBenchmark {
  year: number;
  /** Radii in metres for N, NE, E, SE, S, SW, W, NW. */
  radii: number[];
}

export interface EnvelopeModel {
  centre: LonLat;
  benchmarks: EnvelopeBenchmark[];
  outline_noise: number;
  seed: number;
}

/** Deterministic pseudo-random generator (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function radiiAt(model: EnvelopeModel, year: number): number[] {
  const marks = model.benchmarks;
  const first = marks[0];
  const last = marks[marks.length - 1];
  if (!first || !last) throw new Error("Envelope model has no benchmarks");
  if (year <= first.year) return first.radii.slice();
  if (year >= last.year) return last.radii.slice();
  for (let i = 0; i < marks.length - 1; i += 1) {
    const a = marks[i] as EnvelopeBenchmark;
    const b = marks[i + 1] as EnvelopeBenchmark;
    if (year >= a.year && year <= b.year) {
      const t = (year - a.year) / (b.year - a.year);
      return a.radii.map((r, k) => r + t * ((b.radii[k] ?? r) - r));
    }
  }
  return last.radii.slice();
}

const phaseCache = new WeakMap<EnvelopeModel, [number, number, number]>();

function phases(model: EnvelopeModel): [number, number, number] {
  let cached = phaseCache.get(model);
  if (!cached) {
    const rand = seededRandom(model.seed);
    cached = [rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2];
    phaseCache.set(model, cached);
  }
  return cached;
}

/** Static outline wobble factor for a bearing (degrees clockwise from north). */
export function wobble(model: EnvelopeModel, bearingDeg: number): number {
  const [p1, p2, p3] = phases(model);
  const t = (bearingDeg * Math.PI) / 180;
  const w = 0.5 * Math.sin(3 * t + p1) + 0.3 * Math.sin(7 * t + p2) + 0.2 * Math.sin(13 * t + p3);
  return 1 + model.outline_noise * w;
}

/** Envelope radius (metres) at `year` towards `bearingDeg` (clockwise from north). */
export function envelopeRadius(model: EnvelopeModel, year: number, bearingDeg: number): number {
  const radii = radiiAt(model, year);
  const n = radii.length;
  const sector = 360 / n;
  const b = ((bearingDeg % 360) + 360) % 360;
  const i = Math.floor(b / sector);
  const t = (b - i * sector) / sector;
  const smooth = (1 - Math.cos(t * Math.PI)) / 2;
  const r0 = radii[i % n] ?? 0;
  const r1 = radii[(i + 1) % n] ?? 0;
  return (r0 + (r1 - r0) * smooth) * wobble(model, b);
}

/** Closed ring of the envelope at `year`. */
export function envelopeRing(model: EnvelopeModel, year: number, segments = 96): Ring {
  const ring: Ring = [];
  for (let k = 0; k < segments; k += 1) {
    const bearingDeg = (k / segments) * 360;
    const r = envelopeRadius(model, year, bearingDeg);
    const rad = (bearingDeg * Math.PI) / 180;
    ring.push(offset(model.centre, r * Math.sin(rad), r * Math.cos(rad)));
  }
  const first = ring[0];
  if (first) ring.push([first[0], first[1]]);
  return ring;
}

/**
 * First year at which `point` lies inside the envelope, or Infinity if it
 * never does. Radii are non-decreasing over time, so bisection is valid.
 */
export function envelopeYearAt(model: EnvelopeModel, point: LonLat): number {
  const [x, y] = toLocal(model.centre, point);
  const dist = Math.hypot(x, y);
  const bearingDeg = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  const first = model.benchmarks[0];
  const last = model.benchmarks[model.benchmarks.length - 1];
  if (!first || !last) return Infinity;
  if (envelopeRadius(model, first.year, bearingDeg) >= dist) return first.year;
  if (envelopeRadius(model, last.year, bearingDeg) < dist) return Infinity;
  let lo = first.year;
  let hi = last.year;
  for (let iter = 0; iter < 40 && hi - lo > 0.05; iter += 1) {
    const mid = (lo + hi) / 2;
    if (envelopeRadius(model, mid, bearingDeg) >= dist) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** True when every direction's radius never shrinks between benchmarks. */
export function isMonotonic(model: EnvelopeModel): boolean {
  for (let i = 1; i < model.benchmarks.length; i += 1) {
    const prev = model.benchmarks[i - 1] as EnvelopeBenchmark;
    const cur = model.benchmarks[i] as EnvelopeBenchmark;
    if (cur.year <= prev.year) return false;
    if (cur.radii.some((r, k) => r < (prev.radii[k] ?? 0))) return false;
  }
  return true;
}
