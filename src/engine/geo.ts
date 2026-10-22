/**
 * Small, dependency-free geodesy helpers for city-scale work (a few km).
 *
 * Uses a local equirectangular approximation around each point, accurate to
 * well under a metre over the distances used here (< 10 km at 54.6°N).
 */

export type LonLat = [number, number];
export type Ring = LonLat[];

const EARTH_RADIUS = 6_371_008.8;
const DEG = Math.PI / 180;

/** Metres per degree of latitude and longitude at `lat`. */
export function metresPerDegree(lat: number): { lon: number; lat: number } {
  const latRad = lat * DEG;
  return {
    lat: 111_132.92 - 559.82 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad),
    lon: 111_412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad),
  };
}

/** Move a point by dx metres east and dy metres north. */
export function offset([lon, lat]: LonLat, dx: number, dy: number): LonLat {
  const m = metresPerDegree(lat);
  return [lon + dx / m.lon, lat + dy / m.lat];
}

/** Local east/north metres of `p` relative to `origin`. */
export function toLocal(origin: LonLat, p: LonLat): [number, number] {
  const m = metresPerDegree(origin[1]);
  return [(p[0] - origin[0]) * m.lon, (p[1] - origin[1]) * m.lat];
}

/** Great-circle distance in metres (haversine). */
export function distance(a: LonLat, b: LonLat): number {
  const dLat = (b[1] - a[1]) * DEG;
  const dLon = (b[0] - a[0]) * DEG;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b in degrees clockwise from north. */
export function bearing(a: LonLat, b: LonLat): number {
  const [x, y] = toLocal(a, b);
  const deg = Math.atan2(x, y) / DEG;
  return (deg + 360) % 360;
}

function rotate(x: number, y: number, deg: number): [number, number] {
  const r = deg * DEG;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
}

/**
 * Rectangle centred on `centre` (offset dx, dy in a frame rotated by
 * `rotation` degrees counter-clockwise from east). Returns a closed ring
 * wound counter-clockwise.
 */
export function rectangle(
  centre: LonLat,
  width: number,
  depth: number,
  rotation = 0,
  dx = 0,
  dy = 0,
  partRotation = 0,
): Ring {
  const hw = width / 2;
  const hd = depth / 2;
  const corners: [number, number][] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  const ring = corners.map(([x, y]) => {
    const [px, py] = rotate(x, y, partRotation);
    const [ox, oy] = rotate(px + dx, py + dy, rotation);
    return offset(centre, ox, oy);
  });
  const first = ring[0];
  if (!first) throw new Error("rectangle produced no vertices");
  ring.push([first[0], first[1]]);
  return ring;
}

/** Regular polygon approximating a circle of `radius` metres. */
export function circle(centre: LonLat, radius: number, segments = 32, rotation = 0, dx = 0, dy = 0): Ring {
  const [cx, cy] = rotate(dx, dy, rotation);
  const c = offset(centre, cx, cy);
  const ring: Ring = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * 2 * Math.PI;
    ring.push(offset(c, radius * Math.cos(a), radius * Math.sin(a)));
  }
  const first = ring[0];
  if (first) ring.push([first[0], first[1]]);
  return ring;
}

/** Closed outer ring and inner hole of a courtyard building (quadrangle). */
export function courtyard(
  centre: LonLat,
  width: number,
  depth: number,
  wing: number,
  rotation = 0,
  dx = 0,
  dy = 0,
): Ring[] {
  const outer = rectangle(centre, width, depth, rotation, dx, dy);
  const inner = rectangle(centre, Math.max(1, width - 2 * wing), Math.max(1, depth - 2 * wing), rotation, dx, dy);
  return [outer, inner.slice().reverse()];
}

/** Buffer a polyline into a deck polygon of the given width (flat ends). */
export function corridor(path: LonLat[], width: number): Ring {
  if (path.length < 2) throw new Error("corridor needs at least two points");
  const origin = path[0] as LonLat;
  const local = path.map((p) => toLocal(origin, p));
  const left: LonLat[] = [];
  const right: LonLat[] = [];
  const half = width / 2;
  for (let i = 0; i < local.length; i += 1) {
    const prev = local[Math.max(0, i - 1)] as [number, number];
    const next = local[Math.min(local.length - 1, i + 1)] as [number, number];
    const vx = next[0] - prev[0];
    const vy = next[1] - prev[1];
    const len = Math.hypot(vx, vy) || 1;
    const nx = -vy / len;
    const ny = vx / len;
    const [x, y] = local[i] as [number, number];
    left.push(offset(origin, x + nx * half, y + ny * half));
    right.push(offset(origin, x - nx * half, y - ny * half));
  }
  const ring = [...left, ...right.reverse()];
  const first = ring[0] as LonLat;
  ring.push([first[0], first[1]]);
  return ring;
}

/** Ray-casting point-in-ring test (ring may be open or closed). */
export function pointInRing(point: LonLat, ring: Ring): boolean {
  let inside = false;
  const [x, y] = point;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i] as LonLat;
    const b = ring[j] as LonLat;
    const intersects = a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1] || 1e-12) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Point-in-polygon with holes (first ring outer, others holes). */
export function pointInPolygon(point: LonLat, rings: Ring[]): boolean {
  const [outer, ...holes] = rings;
  if (!outer || !pointInRing(point, outer)) return false;
  return !holes.some((hole) => pointInRing(point, hole));
}

/** Shortest distance in metres from a point to a polyline. */
export function distanceToPolyline(point: LonLat, line: LonLat[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = toLocal(point, line[i] as LonLat);
    const b = toLocal(point, line[i + 1] as LonLat);
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a[0] * vx + a[1] * vy) / len2));
    const px = a[0] + t * vx;
    const py = a[1] + t * vy;
    best = Math.min(best, Math.hypot(px, py));
  }
  return best;
}

/** Length of a polyline in metres. */
export function polylineLength(line: LonLat[]): number {
  let total = 0;
  for (let i = 0; i < line.length - 1; i += 1) total += distance(line[i] as LonLat, line[i + 1] as LonLat);
  return total;
}

/** Planar area of a ring in square metres (shoelace in a local frame). */
export function ringArea(ring: Ring): number {
  if (ring.length < 3) return 0;
  const origin = ring[0] as LonLat;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = toLocal(origin, ring[i] as LonLat);
    const [x2, y2] = toLocal(origin, ring[i + 1] as LonLat);
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/**
 * Camera position for looking at `target` from `range` metres away with the
 * given heading (degrees clockwise from north) and tilt (0 = straight down,
 * 90 = horizontal). Mirrors the ArcGIS SceneView camera convention.
 */
export function cameraFromLookAt(
  target: LonLat,
  heading: number,
  tilt: number,
  range: number,
  targetZ = 0,
): { position: [number, number, number]; heading: number; tilt: number } {
  const tiltRad = Math.min(89.5, Math.max(0, tilt)) * DEG;
  const horizontal = range * Math.sin(tiltRad);
  const vertical = range * Math.cos(tiltRad);
  const back = (heading + 180) * DEG;
  const [lon, lat] = offset(target, horizontal * Math.sin(back), horizontal * Math.cos(back));
  return { position: [lon, lat, targetZ + vertical], heading, tilt };
}
