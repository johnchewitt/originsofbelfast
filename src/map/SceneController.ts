/**
 * Drives one ArcGIS SceneView: builds the historic layers, applies the time
 * engine as the year changes, manages lighting, overlays, selection and
 * camera flights. Two controllers run side by side in compare mode.
 */
import Basemap from "@arcgis/core/Basemap.js";
import Camera from "@arcgis/core/Camera.js";
import Color from "@arcgis/core/Color.js";
import Graphic from "@arcgis/core/Graphic.js";
import EsriMap from "@arcgis/core/Map.js";
import Extent from "@arcgis/core/geometry/Extent.js";
import Point from "@arcgis/core/geometry/Point.js";
import Polyline from "@arcgis/core/geometry/Polyline.js";
import Polygon from "@arcgis/core/geometry/Polygon.js";
import MediaLayer from "@arcgis/core/layers/MediaLayer.js";
import ImageElement from "@arcgis/core/layers/support/ImageElement.js";
import ExtentAndRotationGeoreference from "@arcgis/core/layers/support/ExtentAndRotationGeoreference.js";
import WMSLayer from "@arcgis/core/layers/WMSLayer.js";
import WMTSLayer from "@arcgis/core/layers/WMTSLayer.js";
import WebTileLayer from "@arcgis/core/layers/WebTileLayer.js";
import MapImageLayer from "@arcgis/core/layers/MapImageLayer.js";
import ImageryLayer from "@arcgis/core/layers/ImageryLayer.js";
import type Layer from "@arcgis/core/layers/Layer.js";
import type SceneView from "@arcgis/core/views/SceneView.js";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";

import { eraForYear } from "../data/eras";
import type { AppData } from "../data/loaders";
import { cameraFromLookAt, circle, type LonLat } from "../engine/geo";
import { isEventVisible, MASSING_FEATURE_CAP, presentWhereClause, rampByYear } from "../engine/time";
import type { BasemapId, CameraState, ViewMode } from "../engine/urlState";
import type { HistoricalEvent, HistoricMapOverlay } from "../types/history";
import {
  createHistoricLayers,
  LAYER_ORDER,
  landmarkRenderer,
  massingRenderer,
  modernRenderer,
  streetRenderer,
  waterRenderer,
  type HistoricLayers,
  type LayerId,
} from "./layers";
import { PALETTE } from "./palette";

/** Minimum interval between expensive layer updates during playback (ms). */
const UPDATE_INTERVAL_MS = 110;
/** Renderers with embedded years are refreshed when the year moves this much. */
const RENDERER_YEAR_STEP = 0.2;
/** High Street, east to west, for the scripted approach to the Market House. */
const HIGH_STREET_APPROACH: { from: LonLat; to: LonLat } = { from: [-5.92250, 54.60085], to: [-5.92840, 54.59951] };

export interface SceneSettings {
  year: number;
  viewMode: ViewMode;
  basemap: BasemapId;
  modernOpacity: number;
  historicOpacity: number;
  hidden: readonly string[];
  overlay: { config: HistoricMapOverlay; opacity: number } | null;
  storyChapter: string | null;
  trailVisible: boolean;
  selectedEventId: string | null;
  reducedMotion: boolean;
  lightingDate: Date | null;
}

export type CameraRequest =
  | { kind: "event"; eventId: string; approach?: "high-street" }
  | { kind: "era"; year: number }
  | { kind: "fit"; points: LonLat[] }
  | { kind: "camera"; camera: CameraState }
  | { kind: "look"; target: LonLat; heading: number; tilt: number; range: number }
  | { kind: "plan" }
  | { kind: "home" };

export interface HitResult {
  layer: "events" | "landmarks" | "streets" | "massing" | "land" | "water" | "trail";
  attributes: Record<string, unknown>;
}

const BASEMAPS: Record<Exclude<BasemapId, "none">, string> = {
  dark: "dark-gray-vector",
  imagery: "satellite",
  topo: "topo-vector",
};

function lightingFor(year: number, override: Date | null): Date {
  if (override) return override;
  const era = eraForYear(year);
  const y = Math.max(1, Math.floor(year));
  const date = new Date(Date.UTC(2000, era.lighting.month - 1, 15, era.lighting.hour, 0, 0));
  date.setUTCFullYear(y);
  return date;
}

export class SceneController {
  readonly layers: HistoricLayers;
  readonly map: EsriMap;
  private settings: SceneSettings;
  private overlayLayer: Layer | null = null;
  private overlayKey = "";
  private pendingYear: number | null = null;
  private lastFlush = 0;
  private flushTimer: number | null = null;
  private rendererYear = Number.NaN;
  private rendererFlat = false;
  private rendererStory = false;
  private beaconTimer: number | null = null;
  private modernMode: "ghost" | "solid" = "ghost";
  /** False when the present-day buildings layer failed to load. */
  private modernAvailable = true;
  private destroyed = false;
  private handles: { remove(): void }[] = [];

  private viewRef: SceneView | null = null;

  constructor(
    private readonly data: AppData,
    initial: SceneSettings,
    private readonly onCameraSettled?: (camera: CameraState) => void,
    private readonly onNotice?: (text: string) => void,
  ) {
    this.settings = initial;
    this.layers = createHistoricLayers(data.manifest.styles, initial.year);
    if (initial.reducedMotion) this.layers.water.renderer = waterRenderer(false);
    this.map = new EsriMap({
      basemap: initial.basemap === "none" ? undefined : BASEMAPS[initial.basemap],
      ground: "world-elevation",
      layers: LAYER_ORDER.map((id) => this.layers[id]),
    });
    this.map.ground.surfaceColor = new Color(PALETTE.teal);
    this.map.ground.navigationConstraint = { type: "stay-above" };
    this.layers.modern.load().catch((error: unknown) => {
      console.warn("Present-day buildings layer could not be loaded; continuing without it.", error);
      // Keep the illustrative massing on screen rather than fading to an empty present.
      this.modernAvailable = false;
      if (!this.destroyed) this.applyAll(true);
      this.onNotice?.("Present-day buildings could not be loaded, so the illustrative massing stays on screen after 1986.");
    });
    this.drawTrail();
    this.applyLayers(true);
  }

  /** The SceneView, available once {@link attach} has been called. */
  get view(): SceneView {
    if (!this.viewRef) throw new Error("SceneController is not attached to a view yet");
    return this.viewRef;
  }

  /** Bind to the view created by the <arcgis-scene> component once it is ready. */
  attach(view: SceneView): void {
    this.viewRef = view;
    // The 3D layer view caps how many features it draws (lower on the "low"
    // quality profile); raise it so the peak-year massing is never thinned.
    void view
      .whenLayerView(this.layers.massing)
      .then((layerView) => {
        const lv = layerView as unknown as { maximumNumberOfFeatures?: number };
        if (typeof lv.maximumNumberOfFeatures === "number") lv.maximumNumberOfFeatures = Math.max(lv.maximumNumberOfFeatures, MASSING_FEATURE_CAP);
      })
      .catch((error: unknown) => console.warn("Massing layer view unavailable", error));
    this.handles.push(
      reactiveUtils.when(
        () => view.stationary,
        () => {
          const cam = view.camera;
          if (!cam?.position) return;
          this.onCameraSettled?.({
            lon: cam.position.longitude ?? 0,
            lat: cam.position.latitude ?? 0,
            z: cam.position.z ?? 0,
            heading: cam.heading,
            tilt: cam.tilt,
          });
        },
      ),
    );
    this.applyAll(true);
  }

  /** Apply new settings; only what changed is touched. */
  update(next: SceneSettings): void {
    const prev = this.settings;
    this.settings = next;
    if (prev.basemap !== next.basemap) this.applyBasemap();
    if (prev.overlay?.config.id !== next.overlay?.config.id || prev.overlay?.opacity !== next.overlay?.opacity) this.applyOverlay();
    if (prev.trailVisible !== next.trailVisible) this.layers.trail.visible = next.trailVisible;
    if (prev.selectedEventId !== next.selectedEventId) this.applySelection();
    if (prev.reducedMotion !== next.reducedMotion) {
      this.layers.water.renderer = waterRenderer(!next.reducedMotion);
      this.applySelection();
    }
    const structural =
      prev.viewMode !== next.viewMode ||
      prev.hidden.join() !== next.hidden.join() ||
      prev.modernOpacity !== next.modernOpacity ||
      prev.historicOpacity !== next.historicOpacity ||
      prev.storyChapter !== next.storyChapter ||
      prev.lightingDate?.getTime() !== next.lightingDate?.getTime();
    if (structural) {
      this.applyAll(true);
    } else if (prev.year !== next.year) {
      this.scheduleYear(next.year);
    }
  }

  private scheduleYear(year: number): void {
    this.pendingYear = year;
    const now = performance.now();
    const wait = Math.max(0, UPDATE_INTERVAL_MS - (now - this.lastFlush));
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      if (this.pendingYear === null || this.destroyed) return;
      this.pendingYear = null;
      this.lastFlush = performance.now();
      this.applyAll(false);
    }, wait);
  }

  private applyAll(force: boolean): void {
    if (this.destroyed) return;
    this.applyLayers(force);
    if (this.viewRef) this.applyEnvironment();
  }

  private applyLayers(force: boolean): void {
    if (this.destroyed) return;
    const s = this.settings;
    const year = s.year;
    const L = this.layers;
    const hidden = new Set(s.hidden);
    const flat = s.viewMode === "plan";

    // Visibility toggles.
    for (const id of LAYER_ORDER) {
      if (id === "trail" || id === "selection") continue;
      L[id].visible = !hidden.has(id);
    }

    // Time filters (the SQL mirrors isPresent()).
    L.envelope.definitionExpression = presentWhereClause(year, "start_year", "end_year");
    L.water.definitionExpression = presentWhereClause(year, "build_start", "end_year");
    L.land.definitionExpression = `(start_year <= ${year.toFixed(3)}) AND (highlight_until > ${year.toFixed(3)})`;
    L.streets.definitionExpression = presentWhereClause(year, "start_year", "end_year");
    L.rail.definitionExpression = presentWhereClause(year, "start_year", "end_year");
    L.massing.definitionExpression = presentWhereClause(year, "b", "e");
    L.landmarks.definitionExpression = presentWhereClause(year, "build_start", "end_year");

    const visibleEvents = this.data.events.filter((e) => e.longitude !== null && isEventVisible(e, year, { chapter: s.storyChapter }));
    L.events.definitionExpression = visibleEvents.length ? `event_id IN (${visibleEvents.map((e) => `'${e.event_id}'`).join(",")})` : "1=0";
    const placeIds = [...new Set(visibleEvents.map((e) => e.place_id).filter((p): p is string => Boolean(p)))];
    L.uncertainty.definitionExpression = placeIds.length ? `place_id IN (${placeIds.map((p) => `'${p}'`).join(",")})` : "1=0";

    // Growth renderers (embed the year) — refreshed in steps.
    const story = s.storyChapter === "1798";
    if (force || flat !== this.rendererFlat || story !== this.rendererStory || Math.abs(year - this.rendererYear) >= RENDERER_YEAR_STEP) {
      L.massing.renderer = massingRenderer(year, this.data.manifest.styles, flat);
      L.landmarks.renderer = landmarkRenderer(year, flat);
      L.streets.renderer = streetRenderer(year, story);
      this.rendererYear = year;
      this.rendererFlat = flat;
      this.rendererStory = story;
    }

    // Illustrative massing hands over to the real present-day city.
    const [fadeStart, fadeEnd] = this.data.manifest.fade_to_modern;
    const handOver = this.modernAvailable ? rampByYear(year, [fadeStart, fadeEnd], 1, 0) : 1;
    L.massing.opacity = s.historicOpacity * handOver;
    L.landmarks.opacity = Math.max(0.15, s.historicOpacity);
    L.envelope.opacity = s.historicOpacity * (this.modernAvailable ? rampByYear(year, [fadeStart, fadeEnd], 1, 0.35) : 1);
    const modernSolid = year >= (fadeStart + fadeEnd) / 2;
    const mode = modernSolid ? "solid" : "ghost";
    if (mode !== this.modernMode || force) {
      L.modern.renderer = modernRenderer(mode);
      this.modernMode = mode;
    }
    L.modern.opacity = modernSolid ? rampByYear(year, [fadeStart, fadeEnd], s.modernOpacity, 1) : s.modernOpacity;
    L.modern.visible = !hidden.has("modern") && !flat && (modernSolid || s.modernOpacity > 0.02);

    this.applyBasemapOpacity();
  }

  private applyBasemap(): void {
    const id = this.settings.basemap;
    this.map.basemap = id === "none" ? (null as unknown as Basemap) : Basemap.fromId(BASEMAPS[id]);
    this.applyBasemapOpacity();
  }

  private applyBasemapOpacity(): void {
    const basemap = this.map.basemap;
    if (!basemap) return;
    const s = this.settings;
    const [fadeStart, fadeEnd] = this.data.manifest.fade_to_modern;
    const base = rampByYear(s.year, [fadeStart, fadeEnd], Math.max(0.12, s.modernOpacity), 1);
    basemap.baseLayers.forEach((layer) => {
      layer.opacity = base;
    });
    const showLabels = s.year >= fadeStart || s.modernOpacity >= 0.6;
    basemap.referenceLayers.forEach((layer) => {
      layer.visible = showLabels;
    });
  }

  private applyEnvironment(): void {
    const s = this.settings;
    const era = eraForYear(s.year);
    const env = this.viewRef?.environment;
    if (!env) return;
    env.lighting = { type: "sun", date: lightingFor(s.year, s.lightingDate), directShadowsEnabled: s.viewMode === "3d" };
    const weatherType = s.viewMode === "plan" ? "sunny" : era.weather;
    const current = env.weather?.type;
    if (current !== weatherType) {
      switch (weatherType) {
        case "foggy":
          env.weather = { type: "foggy", fogStrength: 0.25 };
          break;
        case "cloudy":
          env.weather = { type: "cloudy", cloudCover: 0.55 };
          break;
        case "rainy":
          env.weather = { type: "rainy", cloudCover: 0.7, precipitation: 0.15 };
          break;
        default:
          env.weather = { type: "sunny", cloudCover: 0.25 };
      }
    }
  }

  private applyOverlay(): void {
    const next = this.settings.overlay;
    const key = next ? `${next.config.id}` : "";
    if (key !== this.overlayKey) {
      if (this.overlayLayer) this.map.remove(this.overlayLayer);
      this.overlayLayer = next ? createOverlayLayer(next.config) : null;
      if (this.overlayLayer) this.map.add(this.overlayLayer, 1);
      this.overlayKey = key;
    }
    if (this.overlayLayer && next) this.overlayLayer.opacity = next.opacity;
  }

  private drawTrail(): void {
    const trail = this.data.trail;
    const path = new Graphic({
      geometry: new Polyline({ paths: [trail.path], spatialReference: { wkid: 4326 } }),
      symbol: {
        type: "line-3d",
        symbolLayers: [
          { type: "line", material: { color: [232, 183, 107, 0.35] }, size: 9, cap: "round", join: "round" },
          { type: "line", material: { color: [232, 183, 107, 1] }, size: 3, cap: "round", join: "round", pattern: { type: "style", style: "dash" } },
        ],
      },
      attributes: { kind: "path" },
    });
    const stops = trail.stops.map(
      (stop) =>
        new Graphic({
          geometry: new Point({ longitude: stop.longitude, latitude: stop.latitude }),
          attributes: { kind: "stop", event_id: stop.event_id, order: stop.order, label: stop.label },
          symbol: {
            type: "point-3d",
            symbolLayers: [
              { type: "icon", resource: { primitive: "circle" }, material: { color: [7, 25, 35, 0.92] }, outline: { color: [232, 183, 107, 1], size: 2 }, size: 24 },
              { type: "text", text: String(stop.order), material: { color: [232, 183, 107, 1] }, size: 11, font: { family: "Noto Sans", weight: "bold" } },
            ],
            verticalOffset: { screenLength: 22 },
            callout: { type: "line", color: [232, 183, 107, 0.8], size: 1 },
          },
        }),
    );
    this.layers.trail.addMany([path, ...stops]);
    this.layers.trail.visible = this.settings.trailVisible;
  }

  private applySelection(): void {
    const layer = this.layers.selection;
    layer.removeAll();
    if (this.beaconTimer !== null) {
      window.clearInterval(this.beaconTimer);
      this.beaconTimer = null;
    }
    const event = this.settings.selectedEventId ? this.data.eventsById.get(this.settings.selectedEventId) : undefined;
    if (!event || event.longitude === null || event.latitude === null) return;
    const centre: LonLat = [event.longitude, event.latitude];
    const radius = Math.max(12, Math.min(event.location_uncertainty_m ?? 20, 400));
    const ring = new Graphic({
      geometry: new Polygon({ rings: [circle(centre, radius, 64)], spatialReference: { wkid: 4326 } }),
      symbol: {
        type: "polygon-3d",
        symbolLayers: [{ type: "fill", material: { color: [232, 183, 107, 0.12] }, outline: { color: [232, 183, 107, 1], size: 2.5 } }],
      },
    });
    const beam = new Graphic({
      geometry: new Point({ longitude: centre[0], latitude: centre[1] }),
      symbol: {
        type: "point-3d",
        symbolLayers: [
          { type: "object", resource: { primitive: "cylinder" }, material: { color: [232, 183, 107, 0.35] }, width: 2.2, depth: 2.2, height: radius > 200 ? 260 : 70, anchor: "bottom" },
        ],
      },
    });
    layer.addMany([ring, beam]);
    if (!this.settings.reducedMotion) {
      let t = 0;
      this.beaconTimer = window.setInterval(() => {
        t += 1;
        const scale = 0.85 + 0.25 * (0.5 + 0.5 * Math.sin(t / 3));
        ring.geometry = new Polygon({ rings: [circle(centre, radius * scale, 64)], spatialReference: { wkid: 4326 } });
      }, 90);
    }
  }

  /** Fly the camera; honours reduced motion. */
  async flyTo(request: CameraRequest): Promise<void> {
    if (!this.viewRef) return;
    const reduced = this.settings.reducedMotion;
    const options = { animate: !reduced, duration: reduced ? 0 : 2600, easing: "cubic-in-out" as const };
    try {
      switch (request.kind) {
        case "event": {
          const event = this.data.eventsById.get(request.eventId);
          if (!event || event.longitude === null || event.latitude === null) return;
          if (request.approach === "high-street" && !reduced) {
            await this.highStreetApproach(event);
            return;
          }
          await this.view.goTo(this.cameraForEvent(event), options);
          return;
        }
        case "era": {
          const era = eraForYear(request.year);
          const cam = cameraFromLookAt(era.camera.target, era.camera.heading, era.camera.tilt, era.camera.range);
          await this.view.goTo(toCamera(cam), { ...options, duration: reduced ? 0 : 3200 });
          return;
        }
        case "look": {
          await this.view.goTo(toCamera(cameraFromLookAt(request.target, request.heading, request.tilt, request.range)), options);
          return;
        }
        case "fit": {
          if (request.points.length === 0) return;
          const xs = request.points.map((p) => p[0]);
          const ys = request.points.map((p) => p[1]);
          const extent = new Extent({ xmin: Math.min(...xs), xmax: Math.max(...xs), ymin: Math.min(...ys), ymax: Math.max(...ys), spatialReference: { wkid: 4326 } });
          await this.view.goTo({ target: extent.expand(1.6), tilt: 55, heading: this.view.camera?.heading ?? 0 }, options);
          return;
        }
        case "camera": {
          const c = request.camera;
          await this.view.goTo(new Camera({ position: new Point({ longitude: c.lon, latitude: c.lat, z: c.z }), heading: c.heading, tilt: c.tilt }), { ...options, animate: false });
          return;
        }
        case "plan": {
          const target = this.view.center ?? new Point({ longitude: -5.9285, latitude: 54.5998 });
          await this.view.goTo({ target, tilt: 0, heading: 0 }, options);
          return;
        }
        case "home": {
          await this.flyTo({ kind: "era", year: this.settings.year });
          return;
        }
      }
    } catch (error) {
      // goTo rejects when interrupted by a newer request — expected during tours.
      if ((error as { name?: string }).name !== "AbortError") console.debug("Camera flight interrupted", error);
    }
  }

  private cameraForEvent(event: HistoricalEvent): Camera {
    const hint = event.camera;
    const uncertainty = event.location_uncertainty_m ?? 50;
    const range = hint?.range ?? (uncertainty > 500 ? 7000 : Math.max(260, uncertainty * 6));
    const heading = hint?.heading ?? this.view.camera?.heading ?? 20;
    const tilt = hint?.tilt ?? (uncertainty > 500 ? 55 : 68);
    return toCamera(cameraFromLookAt([event.longitude as number, event.latitude as number], heading, tilt, range));
  }

  /** Low glide down High Street from the quay to the Market House. */
  private async highStreetApproach(event: HistoricalEvent): Promise<void> {
    const start = new Camera({
      position: new Point({ longitude: HIGH_STREET_APPROACH.from[0], latitude: HIGH_STREET_APPROACH.from[1], z: 32 }),
      heading: 247,
      tilt: 80,
    });
    await this.view.goTo(start, { duration: 2200, easing: "cubic-in-out" });
    const end = toCamera(cameraFromLookAt(HIGH_STREET_APPROACH.to, 252, 78, 150));
    await this.view.goTo(end, { duration: 9000, easing: "ease-in-out" });
    if (event.camera) await this.view.goTo(this.cameraForEvent(event), { duration: 2400, easing: "cubic-in-out" });
  }

  /** Identify the feature under a screen point. */
  async hitTest(screenPoint: { x: number; y: number }): Promise<HitResult | null> {
    if (!this.viewRef) return null;
    const L = this.layers;
    const response = await this.view.hitTest(screenPoint, { include: [L.events, L.trail, L.landmarks, L.streets, L.massing, L.land, L.water] });
    for (const result of response.results) {
      if (result.type !== "graphic") continue;
      const layerId = result.graphic.layer?.id as LayerId | undefined;
      if (!layerId) continue;
      const attributes = (result.graphic.attributes ?? {}) as Record<string, unknown>;
      if (layerId === "trail" && attributes.kind !== "stop") continue;
      return { layer: layerId as HitResult["layer"], attributes };
    }
    return null;
  }

  async screenshot(): Promise<string> {
    const shot = await this.view.takeScreenshot({ format: "png" });
    return shot.dataUrl;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
    if (this.beaconTimer !== null) window.clearInterval(this.beaconTimer);
    for (const h of this.handles) h.remove();
  }
}

function toCamera(c: { position: [number, number, number]; heading: number; tilt: number }): Camera {
  return new Camera({ position: new Point({ longitude: c.position[0], latitude: c.position[1], z: c.position[2] }), heading: c.heading, tilt: c.tilt });
}

/** Build a layer for a configured historic map overlay. */
export function createOverlayLayer(config: HistoricMapOverlay): Layer | null {
  try {
    if (config.kind === "image" && config.georeference) {
      const g = config.georeference;
      const image = new ImageElement({
        image: config.url.startsWith("http") ? config.url : `${import.meta.env.BASE_URL}${config.url}`,
        georeference: new ExtentAndRotationGeoreference({
          extent: new Extent({ xmin: g.xmin, ymin: g.ymin, xmax: g.xmax, ymax: g.ymax, spatialReference: { wkid: 4326 } }),
        }),
      });
      return new MediaLayer({ id: "overlay", title: config.title, source: [image], copyright: config.attribution });
    }
    if (!config.url) return null;
    switch (config.service_type) {
      case "wms":
        return new WMSLayer({ id: "overlay", url: config.url, title: config.title, copyright: config.attribution });
      case "wmts":
        return new WMTSLayer({ id: "overlay", url: config.url, title: config.title, copyright: config.attribution });
      case "map-image":
        return new MapImageLayer({ id: "overlay", url: config.url, title: config.title, copyright: config.attribution });
      case "imagery":
        return new ImageryLayer({ id: "overlay", url: config.url, title: config.title, copyright: config.attribution });
      case "tile":
      case "web-tile":
        return new WebTileLayer({ id: "overlay", urlTemplate: config.url, title: config.title, copyright: config.attribution });
      default:
        return null;
    }
  } catch (error) {
    console.warn(`Overlay ${config.id} could not be created`, error);
    return null;
  }
}
