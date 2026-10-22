/**
 * Download named street centrelines for central Belfast from OpenStreetMap.
 *
 * Writes data/osm/streets.geojson, which `npm run data:build` then joins to
 * the curated period street list (by name and proximity). The historical
 * attributes — first evidence, sources, closures — stay curated; only the
 * geometry becomes OpenStreetMap's. Present-day alignments are a far better
 * stand-in for historic streets than the schematic polylines, but they are
 * still modern geometry: streets that were later widened or realigned keep
 * their modern shape.
 *
 * Usage:
 *   npm run data:osm                  # default Overpass endpoint
 *   OVERPASS_URL=https://... npm run data:osm
 *   npm run data:osm -- --strict      # exit 1 on failure (default: warn)
 *
 * Licence: OpenStreetMap data is © OpenStreetMap contributors and available
 * under the Open Database Licence (ODbL 1.0). If you publish the build output
 * with OSM geometry, keep the attribution (the app shows it automatically)
 * and note that the derived street layer is subject to the ODbL.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = resolve(ROOT, "data/osm/streets.geojson");
const ENDPOINT = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const STRICT = process.argv.includes("--strict");

/** South, west, north, east — the inner city plus the docks and Titanic Quarter. */
const BBOX: [number, number, number, number] = [54.565, -5.985, 54.635, -5.875];
/** Highway classes that can carry a historic street name. */
const HIGHWAY_CLASSES = [
  "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
  "living_street", "pedestrian", "service", "footway", "path", "steps",
];
const TIMEOUT_S = 120;

interface OverpassWay {
  type: "way";
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

function buildQuery(): string {
  const [s, w, n, e] = BBOX;
  const classes = HIGHWAY_CLASSES.join("|");
  return `[out:json][timeout:${TIMEOUT_S}];way["highway"~"^(${classes})$"]["name"](${s},${w},${n},${e});out tags geom;`;
}

async function main(): Promise<void> {
  console.info(`[osm] Querying ${ENDPOINT} for named highways in ${BBOX.join(", ")} …`);
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "belfast-rising-data-build/0.1 (+https://github.com/)" },
    body: `data=${encodeURIComponent(buildQuery())}`,
    signal: AbortSignal.timeout((TIMEOUT_S + 30) * 1000),
  });
  if (!response.ok) throw new Error(`Overpass returned HTTP ${response.status}`);
  const body = (await response.json()) as { elements?: OverpassWay[]; osm3s?: { timestamp_osm_base?: string } };
  const ways = (body.elements ?? []).filter((el) => el.type === "way" && el.geometry && el.geometry.length >= 2 && el.tags?.name);
  if (ways.length === 0) throw new Error("Overpass returned no named ways — check the bounding box or endpoint.");

  const features = ways.map((way) => ({
    type: "Feature" as const,
    geometry: {
      type: "LineString" as const,
      coordinates: (way.geometry ?? []).map((p) => [Math.round(p.lon * 1e6) / 1e6, Math.round(p.lat * 1e6) / 1e6]),
    },
    properties: {
      osm_id: `way/${way.id}`,
      name: way.tags?.name ?? "",
      alt_name: way.tags?.alt_name ?? null,
      old_name: way.tags?.old_name ?? null,
      highway: way.tags?.highway ?? null,
    },
  }));

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(
    OUT_FILE,
    `${JSON.stringify({
      type: "FeatureCollection",
      attribution: "© OpenStreetMap contributors — Open Database Licence (ODbL 1.0)",
      licence_url: "https://www.openstreetmap.org/copyright",
      osm_base: body.osm3s?.timestamp_osm_base ?? null,
      features,
    })}\n`,
    { encoding: "utf-8" },
  );
  console.info(`[osm] Wrote ${features.length} named ways to ${OUT_FILE}. Run "npm run data:build" to join them.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (STRICT) {
    console.error(`[osm] Failed: ${message}`);
    process.exit(1);
  }
  console.warn(`[osm] Skipped: ${message}. The build will keep the schematic street alignments.`);
});
