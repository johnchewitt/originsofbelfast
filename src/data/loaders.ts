/**
 * Loads the generated datasets from public/data. All files are static JSON so
 * the app can be hosted on GitHub Pages without a server.
 */
import { CONFIG } from "../config";
import type { DataManifest, HistoricalEvent, HistoricMapOverlay, SourceRecord, Tour, Trail } from "../types/history";
import type { PlaceRecord } from "../engine/search";

export interface AppData {
  manifest: DataManifest;
  events: HistoricalEvent[];
  eventsById: Map<string, HistoricalEvent>;
  sources: Map<string, SourceRecord>;
  places: PlaceRecord[];
  placesById: Map<string, PlaceRecord>;
  tours: Tour[];
  trail: Trail;
  overlays: HistoricMapOverlay[];
}

async function getJson<T>(file: string): Promise<T> {
  const response = await fetch(`${CONFIG.dataBase}${file}`);
  if (!response.ok) throw new Error(`Could not load ${file} (${response.status} ${response.statusText})`);
  return (await response.json()) as T;
}

export async function loadAppData(): Promise<AppData> {
  const [manifest, events, sources, places, tours, trail, overlays] = await Promise.all([
    getJson<DataManifest>("manifest.json"),
    getJson<HistoricalEvent[]>("events.json"),
    getJson<SourceRecord[]>("sources.json"),
    getJson<PlaceRecord[]>("places.json"),
    getJson<{ tours: Tour[] }>("tours.json"),
    getJson<Trail>("trail.json"),
    getJson<{ overlays: HistoricMapOverlay[] }>("overlays.json"),
  ]);
  return {
    manifest,
    events,
    eventsById: new Map(events.map((e) => [e.event_id, e])),
    sources: new Map(sources.map((s) => [s.id, s])),
    places,
    placesById: new Map(places.map((p) => [p.id, p])),
    tours: tours.tours,
    trail,
    overlays: [...overlays.overlays, ...CONFIG.extraOverlays],
  };
}
