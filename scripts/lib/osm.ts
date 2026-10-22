/**
 * Join OpenStreetMap street centrelines to the curated period street list.
 *
 * `npm run data:osm` downloads named highways for central Belfast into
 * data/osm/streets.geojson. During the data build each curated street is
 * matched by name (osm_names) and proximity to its schematic alignment, so
 * the historical attributes (dates, sources) are kept while the geometry
 * becomes OpenStreetMap's.
 */
import { distanceToPolyline, type LonLat } from "../../src/engine/geo";

export interface OsmLine {
  name: string;
  coords: LonLat[];
}

/** Maximum distance (m) between an OSM way and the schematic alignment. */
export const MATCH_TOLERANCE_M = 250;
/** Endpoints closer than this (m) are joined when chaining ways. */
const JOIN_TOLERANCE_DEG = 1e-5;

function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function samePoint(a: LonLat, b: LonLat): boolean {
  return Math.abs(a[0] - b[0]) < JOIN_TOLERANCE_DEG && Math.abs(a[1] - b[1]) < JOIN_TOLERANCE_DEG;
}

/** Greedily chain line pieces that share endpoints into longer polylines. */
export function chainLines(lines: LonLat[][]): LonLat[][] {
  const pool = lines.map((l) => l.slice());
  const out: LonLat[][] = [];
  while (pool.length > 0) {
    let current = pool.shift() as LonLat[];
    let extended = true;
    while (extended) {
      extended = false;
      for (let i = 0; i < pool.length; i += 1) {
        const piece = pool[i] as LonLat[];
        const head = current[0] as LonLat;
        const tail = current[current.length - 1] as LonLat;
        const pHead = piece[0] as LonLat;
        const pTail = piece[piece.length - 1] as LonLat;
        let merged: LonLat[] | null = null;
        if (samePoint(tail, pHead)) merged = [...current, ...piece.slice(1)];
        else if (samePoint(tail, pTail)) merged = [...current, ...piece.slice(0, -1).reverse()];
        else if (samePoint(head, pTail)) merged = [...piece, ...current.slice(1)];
        else if (samePoint(head, pHead)) merged = [...piece.slice().reverse(), ...current.slice(1)];
        if (merged) {
          current = merged;
          pool.splice(i, 1);
          extended = true;
          break;
        }
      }
    }
    out.push(current);
  }
  return out;
}

/**
 * Return OSM geometry for a curated street, or null when nothing matches.
 *
 * @param osmNames - Accepted OSM names for the street.
 * @param schematic - The curated schematic alignment, used to reject
 *   same-named streets elsewhere in the city.
 */
export function matchStreet(osm: OsmLine[], osmNames: string[], schematic: LonLat[]): LonLat[][] | null {
  const wanted = new Set(osmNames.map(normalise));
  const candidates = osm.filter((line) => {
    if (!wanted.has(normalise(line.name))) return false;
    return line.coords.some((p) => distanceToPolyline(p, schematic) <= MATCH_TOLERANCE_M);
  });
  if (candidates.length === 0) return null;
  return chainLines(candidates.map((c) => c.coords));
}

/** Parse the GeoJSON written by fetch-osm into OsmLine records. */
export function readOsmLines(geojson: { features: { properties: { name?: string }; geometry: { type: string; coordinates: unknown } }[] }): OsmLine[] {
  const lines: OsmLine[] = [];
  for (const f of geojson.features) {
    const name = f.properties?.name;
    if (!name) continue;
    if (f.geometry.type === "LineString") {
      lines.push({ name, coords: f.geometry.coordinates as LonLat[] });
    } else if (f.geometry.type === "MultiLineString") {
      for (const part of f.geometry.coordinates as LonLat[][]) lines.push({ name, coords: part });
    }
  }
  return lines;
}
