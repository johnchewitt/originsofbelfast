/**
 * Runtime configuration from Vite environment variables (see .env.example).
 * Nothing secret belongs here: everything below is shipped to the browser.
 */
import type { HistoricMapOverlay } from "./types/history";

function parseServices(raw: string | undefined): HistoricMapOverlay[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoricMapOverlay[]) : [];
  } catch (error) {
    console.warn("VITE_HISTORIC_MAP_SERVICES is not valid JSON and was ignored.", error);
    return [];
  }
}

export const CONFIG = {
  /** Optional ArcGIS location-platform key (restrict it by HTTP referrer). Enables premium basemap styles. */
  apiKey: import.meta.env.VITE_ARCGIS_API_KEY?.trim() || null,
  portalUrl: import.meta.env.VITE_ARCGIS_PORTAL_URL?.trim() || "https://www.arcgis.com",
  /** Esri Living Atlas "OpenStreetMap 3D Buildings" scene layer. */
  osmBuildingsItemId: import.meta.env.VITE_OSM_BUILDINGS_ITEM_ID?.trim() || "ca0470dbbddb4db28bad74ed39949e25",
  /** Optional secure backend for open questions (see server/assistant-proxy). */
  assistantEndpoint: import.meta.env.VITE_ASSISTANT_ENDPOINT?.trim() || null,
  /** Serve ArcGIS assets from ./arcgis-assets instead of the Esri CDN. */
  localAssets: import.meta.env.VITE_ARCGIS_LOCAL_ASSETS === "true",
  /** Extra historic map services (JSON array using the historic-maps.json schema). */
  extraOverlays: parseServices(import.meta.env.VITE_HISTORIC_MAP_SERVICES),
  /** Base URL of the generated data files. */
  dataBase: `${import.meta.env.BASE_URL}data/`,
  assetBase: import.meta.env.BASE_URL,
} as const;
