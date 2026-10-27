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
import FeatureFilter from "@arcgis/core/layers/support/FeatureFilter.js";
import type GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer.js";
import type SimpleRenderer from "@arcgis/core/renderers/SimpleRenderer.js";
import type UniqueValueRenderer from "@arcgis/core/renderers/UniqueValueRenderer.js";

import { eraForYear } from "../data/eras";
import type { AppData } from "../data/loaders";
import { cameraFromLookAt, circle, type LonLat } from "../engine/geo";
import { handoverState, massingWhereClause, type HandoverState } from "../engine/handover";
import { isEventVisible, MASSING_FEATURE_CAP, presentWhereClause, quantize, rendererBreaksFor, snapToBreakpoint, stableRendererYear } from "../engine/time";
import type { BasemapId, CameraState, ViewMode } from "../engine/urlState";
import type { HistoricalEvent, HistoricMapOverlay } from "../types/history";
import {
  createHistoricLayers,
  envelopeRenderer,
  LAYER_ORDER,
  landmarkRenderer,
  landRenderer,
  massingRenderer,
  modernRenderer,
  railRenderer,
  streetRenderer,
  waterRenderer,
  type HistoricLayers,
  type LayerId,
} from "./layers";
import { performanceProfile, styleKey, type DisplayPrefs, type PerformanceProfile } from "./layerStyles";
import { PALETTE } from "./palette";

/** Landmark construction is re-rendered at most this often (years); landmarks are few, so this is cheap. */
const LANDMARK_YEAR_STEP = 0.25;
/** Massing time filters move in steps of this many years, per performance mode. */
const MASSING_YEAR_STEP: Record<DisplayPrefs["performance"], number> = { fast: 1, balanced: 0.25, detailed: 0.05 };
/** Opacity of outlined extrusions is applied this long after the last slider change (ms). */
const OPACITY_SETTLE_MS = 180;
/** …and once the layer view has finished updating, waiting at most this long (ms). */
const OPACITY_MAX_WAIT_MS = 2500;
/** "New street" highlighting is recomputed in steps of this many years, per performance mode. */
const STREET_HIGHLIGHT_STEP: Record<DisplayPrefs["performance"], number> = { fast: 5, balanced: 2, detailed: 0.5 };

/** Small layers whose time filter is snapped to the dates in their own data (see snapToBreakpoint). */
const SNAPPED_LAYERS: { id: LayerId; file: string; start: string; end: string }[] = [
  { id: "envelope", file: "envelope.geojson", start: "start_year", end: "end_year" },
  { id: "water", file: "water.geojson", start: "build_start", end: "end_year" },
  { id: "land", file: "land.geojson", start: "start_year", end: "highlight_until" },
  { id: "streets", file: "streets.geojson", start: "start_year", end: "end_year" },
  { id: "rail", file: "rail.geojson", start: "start_year", end: "end_year" },
  { id: "landmarks", file: "landmarks.geojson", start: "build_start", end: "end_year" },
];
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
  display: DisplayPrefs;
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

/**
 * Sun date for an era's mood. The year is fixed (the sun's path barely
 * changes between years), so lighting is recomputed only when the era — and
 * with it the month and hour — changes, not on every year of playback.
 */
function lightingFor(year: number, override: Date | null): Date {
  if (override) return override;
  const era = eraForYear(year);
  return new Date(Date.UTC(2000, era.lighting.month - 1, 15, era.lighting.hour, 0, 0));
}

type WeatherKind = "sunny" | "cloudy" | "foggy" | "rainy" | "clear";

/** Midday sun in early summer: bright, high light with short shadows (fixed, so it never triggers re-lighting). */
const CLEAR_DAYLIGHT = new Date(Date.UTC(2000, 5, 21, 12, 30, 0));

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export class SceneController {
  readonly layers: HistoricLayers;
  readonly map: EsriMap;
  private settings: SceneSettings;
  private overlayLayer: Layer | null = null;
  private overlayKey = "";
  private pendingYear: number | null = null;
  private lastFlush = 0;
  private flushTimer: number | null = null;
  private rendererKeys = new Map<string, string>();
  private lightingKey = "";
  private breakpoints = new Map<LayerId, number[]>();
  /**
   * Dates at which year-dependent renderers change their output, and the
   * intervals in which they change continuously (landmark construction).
   * Renderers are rebuilt only when the year crosses one of these.
   */
  private rendererBreaks = new Map<"landmarks" | "streets", { breaks: number[]; active: [number, number][] }>();
  private opacityTimers = new Map<"massing" | "landmarks", { timer: number; value: number }>();
  /** The massing layer view, once created: time filtering then uses its (cheap) filter. */
  private massingView: { filter: FeatureFilter | null | undefined } | null = null;
  private massingWhere = "";
  private beaconTimer: number | null = null;
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
    private readonly onModernUnavailable?: () => void,
  ) {
    this.settings = initial;
    this.layers = createHistoricLayers(data.manifest.styles, initial.year, initial.display);
    this.applyStyles();
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
      this.onModernUnavailable?.();
    });
    this.drawTrail();
    this.applyLayers(true);
    void this.loadBreakpoints();
  }

  private get profile(): PerformanceProfile {
    return performanceProfile(this.settings.display.performance);
  }

  /**
   * Read the start/end dates of the small time-enabled layers so their
   * filters change only when the year crosses one of those dates. Each
   * filter change makes the layer view reload, so this avoids reloading six
   * layers several times a second during playback.
   */
  private async loadBreakpoints(): Promise<void> {
    await Promise.all(
      SNAPPED_LAYERS.map(async ({ id, file, start, end }) => {
        try {
          const response = await fetch((this.layers[id] as GeoJSONLayer).url ?? file);
          const json = (await response.json()) as { features: { properties: Record<string, unknown> }[] };
          const values = new Set<number>();
          for (const f of json.features) {
            for (const key of [start, end]) {
              const v = Number(f.properties[key]);
              if (Number.isFinite(v)) values.add(v);
            }
          }
          this.breakpoints.set(id, [...values].sort((a, b) => a - b));
          if (id === "landmarks" || id === "streets") this.rendererBreaks.set(id, rendererBreaksFor(id, json.features));
        } catch (error) {
          console.warn(`Could not read dates for ${id}; filtering by exact year instead.`, error);
        }
      }),
    );
    if (!this.destroyed) this.applyLayers(false);
  }

  /** Re-apply renderers that depend on the display preferences. */
  private applyStyles(): void {
    const L = this.layers;
    const d = this.settings.display.layers;
    L.envelope.renderer = envelopeRenderer(d.envelope.colour);
    L.land.renderer = landRenderer(d.land.colour);
    L.rail.renderer = railRenderer(d.rail.colour);
    L.water.renderer = waterRenderer(this.profile.animatedWater && !this.settings.reducedMotion, d.water.colour);
    this.rendererKeys.clear();
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
        if (this.destroyed) return;
        const lv = layerView as unknown as { maximumNumberOfFeatures?: number; filter: FeatureFilter | null | undefined };
        // The SDK estimates its own cap only after the layer view has processed
        // the layer (so it is not yet a number here, and the original one-off
        // raise never took effect) — 8,500 was measured on a software renderer,
        // silently dropping blocks. All blocks are loaded once (time is a
        // filter), so raise the cap above the dataset size as soon as the SDK
        // sets it. The SDK then keeps it as an override; it is not raised while
        // the view is already short of memory.
        const raiseCap = () => {
          const quality = view.performanceInfo?.quality ?? 1;
          if (typeof lv.maximumNumberOfFeatures === "number" && lv.maximumNumberOfFeatures < MASSING_FEATURE_CAP && quality >= 0.9) {
            lv.maximumNumberOfFeatures = MASSING_FEATURE_CAP;
          }
        };
        raiseCap();
        this.handles.push(reactiveUtils.watch(() => lv.maximumNumberOfFeatures, raiseCap));
        // Load every block once and move through time with the layer-view
        // filter: far cheaper than changing the layer's definition expression,
        // which reloads the features on every change.
        this.massingView = lv;
        this.massingWhere = "";
        this.layers.massing.definitionExpression = null as unknown as string;
        this.applyLayers(false);
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
    // Colour, edge or performance changes need new renderers; opacity-only
    // changes are applied to layer.opacity and cost nothing to redraw.
    const styleChanged = prev.reducedMotion !== next.reducedMotion || styleKey(prev.display) !== styleKey(next.display);
    if (styleChanged) this.applyStyles();
    if (prev.reducedMotion !== next.reducedMotion) this.applySelection();
    const structural =
      styleChanged ||
      prev.display !== next.display ||
      prev.viewMode !== next.viewMode ||
      prev.hidden.join() !== next.hidden.join() ||
      prev.modernOpacity !== next.modernOpacity ||
      prev.historicOpacity !== next.historicOpacity ||
      prev.storyChapter !== next.storyChapter ||
      prev.lightingDate?.getTime() !== next.lightingDate?.getTime();
    if (structural) {
      // Renderer keys (view mode, story, styles) decide what is rebuilt.
      this.applyAll(false);
    } else if (prev.year !== next.year) {
      this.scheduleYear(next.year);
    }
  }

  private scheduleYear(year: number): void {
    this.pendingYear = year;
    const now = performance.now();
    const wait = Math.max(0, this.profile.updateIntervalMs - (now - this.lastFlush));
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

    // Visibility toggles (massing and modern also depend on the handover; set once, below).
    for (const id of LAYER_ORDER) {
      if (id === "trail" || id === "selection" || id === "massing" || id === "modern") continue;
      L[id].visible = !hidden.has(id);
    }

    // Time filters (the SQL mirrors isPresent()). Small layers snap to their
    // own dates; massing moves in fixed steps. Unchanged strings are no-ops.
    const snapped = (id: LayerId) => snapToBreakpoint(year, this.breakpoints.get(id));
    const profile = this.profile;
    const display = s.display;
    L.envelope.definitionExpression = presentWhereClause(snapped("envelope"), "start_year", "end_year");
    L.water.definitionExpression = presentWhereClause(snapped("water"), "build_start", "end_year");
    const landYear = snapped("land").toFixed(3);
    L.land.definitionExpression = `(start_year <= ${landYear}) AND (highlight_until > ${landYear})`;
    L.streets.definitionExpression = presentWhereClause(snapped("streets"), "start_year", "end_year");
    L.rail.definitionExpression = presentWhereClause(snapped("rail"), "start_year", "end_year");
    L.landmarks.definitionExpression = presentWhereClause(snapped("landmarks"), "build_start", "end_year");

    // Handover to the present-day city: blocks leave through the filter (one
    // handover year each) — the massing layer's opacity is never animated,
    // because each opacity change stalls the 3D renderer for up to 1.5 s.
    const handover = this.handover(year);
    const massingVisible = !hidden.has("massing") && handover.massingVisible;
    const massingWhere = massingWhereClause(quantize(year, MASSING_YEAR_STEP[display.performance]), handover.retireBlocks && this.hasHandoverField);
    if (this.massingView) {
      // A hidden layer keeps its last filter; it is brought up to date when shown again.
      if (massingVisible && massingWhere !== this.massingWhere) {
        this.massingView.filter = new FeatureFilter({ where: massingWhere });
        this.massingWhere = massingWhere;
      }
    } else {
      L.massing.definitionExpression = massingWhere;
    }

    const visibleEvents = this.data.events.filter((e) => e.longitude !== null && isEventVisible(e, year, { chapter: s.storyChapter }));
    L.events.definitionExpression = visibleEvents.length ? `event_id IN (${visibleEvents.map((e) => `'${e.event_id}'`).join(",")})` : "1=0";
    const placeIds = [...new Set(visibleEvents.map((e) => e.place_id).filter((p): p is string => Boolean(p)))];
    L.uncertainty.definitionExpression = placeIds.length ? `place_id IN (${placeIds.map((p) => `'${p}'`).join(",")})` : "1=0";

    // Renderers are rebuilt only when their inputs change: rebuilding makes
    // the layer re-draw every feature, which is what made playback stutter.
    const story = s.storyChapter === "1798";
    const animate = profile.constructionAnimation && !flat;
    // After the last block is complete every height is final, so the year stops mattering.
    const lastComplete = this.data.manifest.massing_last_complete;
    const massingYear = animate ? (lastComplete !== undefined && year >= lastComplete ? lastComplete : quantize(year, profile.rendererYearStep)) : null;
    const edges = profile.edgesOverride ?? display.layers.massing.edges;
    if (massingVisible || force) {
      this.setRenderer("massing", `${flat}|${massingYear}|${edges}`, force, () => massingRenderer(massingYear, this.data.manifest.styles, flat, display.layers.massing, edges));
    }
    // Year-dependent renderers are rebuilt only when their output changes:
    // landmarks while one is under construction or at a construction date,
    // streets when a street starts or stops glowing as new.
    const landmarkTimes = this.rendererBreaks.get("landmarks");
    const landmarkYear = flat ? 0 : stableRendererYear(quantize(year, LANDMARK_YEAR_STEP), landmarkTimes?.breaks, landmarkTimes?.active);
    this.setRenderer("landmarks", `${flat}|${landmarkYear}`, force, () => landmarkRenderer(landmarkYear || year, flat, display.layers.landmarks));
    const streetYear = stableRendererYear(quantize(year, STREET_HIGHLIGHT_STEP[display.performance]), this.rendererBreaks.get("streets")?.breaks);
    this.setRenderer("streets", `${story}|${streetYear}`, force, () => streetRenderer(streetYear, story, display.layers.streets.colour));

    // Opacities depend on the viewer's settings, and only the stepped
    // handover values depend on the year — so during playback they change a
    // handful of times rather than on every tick.
    const styles = display.layers;
    // Outlined extrusions (massing, landmarks) take opacity once a slider has settled.
    this.setExtrusionOpacity("massing", round3(s.historicOpacity * styles.massing.opacity), force);
    L.massing.visible = massingVisible;
    this.setExtrusionOpacity("landmarks", round3(Math.max(0.15, s.historicOpacity) * styles.landmarks.opacity), force);
    L.envelope.opacity = round3(s.historicOpacity * styles.envelope.opacity * handover.envelopeFactor);
    L.streets.opacity = styles.streets.opacity;
    L.water.opacity = styles.water.opacity;
    L.land.opacity = styles.land.opacity;
    L.rail.opacity = styles.rail.opacity;
    // The present-day buildings fade in at the start of the handover (cheap
    // on the scene layer), so the city never empties between model and present.
    const mode = handover.modernMode;
    this.setRenderer("modern", `${mode}`, force, () => modernRenderer(mode, styles.modern.colour));
    L.modern.opacity = handover.modernOpacity;
    L.modern.visible = !hidden.has("modern") && !flat && (mode === "solid" || s.modernOpacity > 0.02);

    this.applyBasemapOpacity(handover);
  }

  /**
   * Opacity for the outlined extrusion layers. Each change makes the 3D view
   * rebuild their edges — measured at 0.3–1.5 s on an integrated GPU, and the
   * SDK's edge renderer can throw ("no object") when changes arrive while it is
   * still rebuilding. A slider drag would fire one per step, so the value is
   * applied once the slider has rested and the layer view has finished
   * updating (or after OPACITY_MAX_WAIT_MS); the first and forced values
   * apply at once.
   */
  private setExtrusionOpacity(id: "massing" | "landmarks", value: number, force: boolean): void {
    const layer = this.layers[id];
    const pending = this.opacityTimers.get(id);
    // Same target already waiting (e.g. playback ticks while it settles): leave it alone.
    if (pending && pending.value === value && !force) return;
    if (pending) window.clearTimeout(pending.timer);
    this.opacityTimers.delete(id);
    if (layer.opacity === value) return;
    if (force || !this.viewRef) {
      layer.opacity = value;
      return;
    }
    const view = this.viewRef;
    const apply = () => {
      // A newer value may have replaced this one while we waited.
      if (this.destroyed || this.opacityTimers.get(id)?.value !== value) return;
      this.opacityTimers.delete(id);
      layer.opacity = value;
    };
    const timer = window.setTimeout(() => {
      const layerView = view.allLayerViews.find((lv) => lv.layer === layer);
      if (!layerView?.updating) {
        apply();
        return;
      }
      const ready = reactiveUtils.whenOnce(() => !layerView.updating);
      const timeout = new Promise((resolve) => window.setTimeout(resolve, OPACITY_MAX_WAIT_MS));
      void Promise.race([ready, timeout]).then(apply);
    }, OPACITY_SETTLE_MS);
    this.opacityTimers.set(id, { timer, value });
  }

  /** True when the massing data carries per-block handover years. */
  private get hasHandoverField(): boolean {
    return this.data.manifest.phases?.handover_field === "r";
  }

  private handover(year: number): HandoverState {
    const s = this.settings;
    return handoverState(year, this.data.manifest.fade_to_modern, {
      modernOpacity: s.modernOpacity,
      modernAvailable: this.modernAvailable,
      // Blocks only step aside for present-day buildings that are actually drawn.
      modernDrawn: s.viewMode !== "plan" && !s.hidden.includes("modern"),
    });
  }

  /** Assign a renderer only when its key changes (or when forced). */
  private setRenderer(id: "massing" | "landmarks" | "streets" | "modern", key: string, force: boolean, make: () => SimpleRenderer | UniqueValueRenderer): void {
    if (!force && this.rendererKeys.get(id) === key) return;
    (this.layers[id] as { renderer: SimpleRenderer | UniqueValueRenderer }).renderer = make();
    this.rendererKeys.set(id, key);
  }

  private applyBasemap(): void {
    const id = this.settings.basemap;
    this.map.basemap = id === "none" ? (null as unknown as Basemap) : Basemap.fromId(BASEMAPS[id]);
    this.applyBasemapOpacity();
  }

  private applyBasemapOpacity(handover: HandoverState = this.handover(this.settings.year)): void {
    const basemap = this.map.basemap;
    if (!basemap) return;
    // Stepped values: the draped basemap is re-composited only when a step is crossed.
    basemap.baseLayers.forEach((layer) => {
      if (layer.opacity !== handover.basemapOpacity) layer.opacity = handover.basemapOpacity;
    });
    basemap.referenceLayers.forEach((layer) => {
      if (layer.visible !== handover.showReferenceLabels) layer.visible = handover.showReferenceLabels;
    });
  }

  private applyEnvironment(): void {
    const s = this.settings;
    const env = this.viewRef?.environment;
    if (!env) return;
    const flat = s.viewMode === "plan";
    const shadows = this.profile.shadows && !flat;
    const mode = s.display.lighting;
    const era = eraForYear(s.year);
    let lighting: { type: "sun"; date: Date; directShadowsEnabled: boolean } | { type: "virtual"; directShadowsEnabled: boolean };
    let weather: WeatherKind;
    if (mode === "even") {
      lighting = { type: "virtual", directShadowsEnabled: false };
      weather = "sunny";
    } else if (mode === "clear") {
      lighting = { type: "sun", date: s.lightingDate ?? CLEAR_DAYLIGHT, directShadowsEnabled: shadows };
      weather = "clear";
    } else {
      lighting = { type: "sun", date: lightingFor(s.year, s.lightingDate), directShadowsEnabled: shadows };
      weather = flat ? "sunny" : era.weather;
    }
    // Reassigning lighting makes the view recompute shading and shadows, so
    // only do it when something actually changed (not on every year tick).
    const key = `${lighting.type}|${"date" in lighting ? lighting.date.getTime() : ""}|${lighting.directShadowsEnabled}|${weather}`;
    if (key === this.lightingKey) return;
    this.lightingKey = key;
    env.lighting = lighting;
    switch (weather) {
      case "foggy":
        env.weather = { type: "foggy", fogStrength: 0.25 };
        break;
      case "cloudy":
        env.weather = { type: "cloudy", cloudCover: 0.55 };
        break;
      case "rainy":
        env.weather = { type: "rainy", cloudCover: 0.7, precipitation: 0.15 };
        break;
      case "clear":
        env.weather = { type: "sunny", cloudCover: 0.05 };
        break;
      default:
        env.weather = { type: "sunny", cloudCover: 0.25 };
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
    for (const t of this.opacityTimers.values()) window.clearTimeout(t.timer);
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
