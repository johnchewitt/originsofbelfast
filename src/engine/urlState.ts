/**
 * Shareable URL state.
 *
 * Only state worth sharing is encoded; everything is validated on the way
 * back in so a hand-edited or truncated link can never break the app.
 */
import { TIMELINE_END, TIMELINE_START } from "../data/eras";

export type ViewMode = "3d" | "plan";
export type BasemapId = "dark" | "imagery" | "topo" | "none";

export interface CameraState {
  lon: number;
  lat: number;
  z: number;
  heading: number;
  tilt: number;
}

export interface ShareableState {
  year: number;
  camera: CameraState | null;
  eventId: string | null;
  tourId: string | null;
  tourStep: number;
  compareYear: number | null;
  viewMode: ViewMode;
  basemap: BasemapId;
  overlayId: string | null;
  overlayOpacity: number;
  modernOpacity: number;
  hiddenLayers: string[];
}

export const DEFAULT_SHAREABLE: ShareableState = {
  year: 1791.8,
  camera: null,
  eventId: null,
  tourId: null,
  tourStep: 0,
  compareYear: null,
  viewMode: "3d",
  basemap: "dark",
  overlayId: null,
  overlayOpacity: 0.7,
  modernOpacity: 0.35,
  hiddenLayers: [],
};

const BASEMAPS: BasemapId[] = ["dark", "imagery", "topo", "none"];
const ID_PATTERN = /^[a-z0-9-]{1,80}$/;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function num(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeId(value: string | null): string | null {
  return value && ID_PATTERN.test(value) ? value : null;
}

/** Serialise state to a query string (without the leading "?"). */
export function encodeState(state: ShareableState): string {
  const p = new URLSearchParams();
  p.set("y", (Math.round(state.year * 1000) / 1000).toString());
  if (state.camera) {
    const c = state.camera;
    p.set("cam", [c.lon.toFixed(5), c.lat.toFixed(5), Math.round(c.z), Math.round(c.heading), Math.round(c.tilt)].join(","));
  }
  if (state.eventId) p.set("e", state.eventId);
  if (state.tourId) {
    p.set("tour", state.tourId);
    p.set("step", String(state.tourStep));
  }
  if (state.compareYear !== null) p.set("cmp", (Math.round(state.compareYear * 100) / 100).toString());
  if (state.viewMode !== "3d") p.set("v", state.viewMode);
  if (state.basemap !== DEFAULT_SHAREABLE.basemap) p.set("b", state.basemap);
  if (state.overlayId) {
    p.set("ov", state.overlayId);
    p.set("ovo", state.overlayOpacity.toFixed(2));
  }
  if (state.modernOpacity !== DEFAULT_SHAREABLE.modernOpacity) p.set("mo", state.modernOpacity.toFixed(2));
  if (state.hiddenLayers.length) p.set("hide", state.hiddenLayers.join("."));
  return p.toString();
}

/** Parse a query string, falling back to defaults for anything invalid. */
export function decodeState(query: string): ShareableState {
  const p = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const state: ShareableState = { ...DEFAULT_SHAREABLE, hiddenLayers: [] };

  const year = num(p.get("y"));
  if (year !== null) state.year = clamp(year, TIMELINE_START, TIMELINE_END);

  const cam = p.get("cam")?.split(",").map(Number);
  if (cam && cam.length === 5 && cam.every(Number.isFinite)) {
    const [lon, lat, z, heading, tilt] = cam as [number, number, number, number, number];
    if (lon > -7 && lon < -5 && lat > 54 && lat < 55.5) {
      state.camera = { lon, lat, z: clamp(z, 5, 200_000), heading: ((heading % 360) + 360) % 360, tilt: clamp(tilt, 0, 90) };
    }
  }

  state.eventId = safeId(p.get("e"));
  state.tourId = safeId(p.get("tour"));
  state.tourStep = state.tourId ? Math.max(0, Math.floor(num(p.get("step")) ?? 0)) : 0;

  const cmp = num(p.get("cmp"));
  state.compareYear = cmp === null ? null : clamp(cmp, TIMELINE_START, TIMELINE_END);

  state.viewMode = p.get("v") === "plan" ? "plan" : "3d";
  const basemap = p.get("b") as BasemapId | null;
  if (basemap && BASEMAPS.includes(basemap)) state.basemap = basemap;

  state.overlayId = safeId(p.get("ov"));
  const ovo = num(p.get("ovo"));
  if (ovo !== null) state.overlayOpacity = clamp(ovo, 0, 1);
  const mo = num(p.get("mo"));
  if (mo !== null) state.modernOpacity = clamp(mo, 0, 1);

  const hide = p.get("hide");
  if (hide) state.hiddenLayers = hide.split(".").filter((id) => ID_PATTERN.test(id)).slice(0, 20);
  return state;
}
