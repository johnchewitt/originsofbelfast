/**
 * Irish Grid (EPSG:29903, TM75) and Irish Transverse Mercator (EPSG:2157)
 * conversions to WGS84 longitude/latitude.
 *
 * The TM75 → WGS84 seven-parameter transformation is accurate to about
 * 1–2 m, far below the positional uncertainty of the historic data.
 */
import proj4 from "proj4";

proj4.defs(
  "EPSG:29903",
  "+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=1.000035 +x_0=200000 +y_0=250000 +ellps=mod_airy " +
    "+towgs84=482.5,-130.6,564.6,-1.042,-0.214,-0.631,8.15 +units=m +no_defs",
);
proj4.defs(
  "EPSG:2157",
  "+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=0.99982 +x_0=600000 +y_0=750000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
);

/** 100 km square letters of the Irish Grid (5 × 5, 'I' omitted). */
const GRID_LETTERS = "VWXYZQRSTULMNOPFGHJKABCDE";

export interface GridReference {
  easting: number;
  northing: number;
  /** Size of the referenced square in metres (e.g. 10 for an 8-figure reference). */
  precision: number;
}

/**
 * Parse an Irish Grid reference such as "J3415 7442" or "J 340 743".
 * Returns the centre of the referenced square.
 */
export function parseIrishGridReference(value: string): GridReference {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  const match = /^([A-HJ-Z])(\d+)$/.exec(compact);
  if (!match) throw new Error(`Invalid Irish Grid reference "${value}"`);
  const letter = match[1] as string;
  const digits = match[2] as string;
  if (digits.length % 2 !== 0 || digits.length < 2 || digits.length > 10) {
    throw new Error(`Irish Grid reference "${value}" must have an even number of digits (2–10).`);
  }
  const index = GRID_LETTERS.indexOf(letter);
  if (index < 0) throw new Error(`Unknown grid square letter in "${value}"`);
  const col = index % 5;
  const row = Math.floor(index / 5);
  const half = digits.length / 2;
  const precision = 10 ** (5 - half);
  const e = Number(digits.slice(0, half)) * precision;
  const n = Number(digits.slice(half)) * precision;
  return {
    easting: col * 100_000 + e + precision / 2,
    northing: row * 100_000 + n + precision / 2,
    precision,
  };
}

export function irishGridToLonLat(easting: number, northing: number): [number, number] {
  const [lon, lat] = proj4("EPSG:29903", "EPSG:4326", [easting, northing]) as [number, number];
  return [lon, lat];
}

export function itmToLonLat(easting: number, northing: number): [number, number] {
  const [lon, lat] = proj4("EPSG:2157", "EPSG:4326", [easting, northing]) as [number, number];
  return [lon, lat];
}
