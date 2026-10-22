/**
 * Copy ArcGIS Maps SDK assets (workers, web-style resources, translations)
 * into public/arcgis-assets so the app can run without the Esri CDN.
 * Use together with VITE_ARCGIS_LOCAL_ASSETS=true. Basemaps, elevation and
 * the OpenStreetMap buildings still come from ArcGIS Online at runtime.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/@arcgis/core/assets");
const target = resolve(root, "public/arcgis-assets");

if (!existsSync(source)) {
  console.error("[assets] @arcgis/core is not installed — run npm ci first.");
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.info(`[assets] Copied ArcGIS assets to ${target}`);
