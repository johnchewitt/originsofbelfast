/**
 * Hosts one or two <arcgis-scene> map components and binds them to
 * SceneControllers. In compare mode the second scene shows `compareYear`
 * and the two cameras stay synchronised.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";
import HighlightOptions from "@arcgis/core/views/support/HighlightOptions.js";
import type SceneView from "@arcgis/core/views/SceneView.js";
import type { ArcgisScene } from "@arcgis/map-components/components/arcgis-scene";
import { useAppState, useDispatch, type AppState } from "../state/store";
import type { AppData } from "../data/loaders";
import { SceneController, type SceneSettings } from "../map/SceneController";
import { registerController } from "../map/registry";
import { formatDecimalYear, toDecimalYear } from "../engine/dates";

function lightingDate(state: AppState, year: number): Date | null {
  const in1798 = state.tour?.id === "tour-1798" || state.trailMode;
  if (!in1798 || year < 1791 || year >= 1801) return null;
  // Late-afternoon light in the month being shown. Monthly steps keep the
  // season right without re-lighting the scene on every frame of a story move.
  const month = Math.min(11, Math.floor((year - Math.floor(year)) * 12));
  return new Date(Date.UTC(2000, month, 15, 17, 0, 0));
}

export function toSceneSettings(state: AppState, data: AppData, year: number): SceneSettings {
  const overlayConfig = state.overlayId ? data.overlays.find((o) => o.id === state.overlayId) : undefined;
  return {
    year,
    viewMode: state.viewMode,
    basemap: state.basemap,
    modernOpacity: state.modernOpacity,
    historicOpacity: state.historicOpacity,
    hidden: state.hiddenLayers,
    overlay: overlayConfig ? { config: overlayConfig, opacity: state.overlayOpacity } : null,
    storyChapter: state.tour?.id === "tour-1798" || state.trailMode ? "1798" : null,
    trailVisible: state.trailMode || (state.tour?.id === "tour-1798" && !state.hiddenLayers.includes("trail")),
    selectedEventId: state.selectedEventId,
    reducedMotion: state.reducedMotion,
    lightingDate: lightingDate(state, year),
    display: state.display,
  };
}

function useSceneController(
  slot: "primary" | "compare",
  data: AppData,
  settings: SceneSettings,
  onReady?: (controller: SceneController) => void,
) {
  const ref = useRef<ArcgisScene | null>(null);
  const [controller, setController] = useState<SceneController | null>(null);
  const dispatch = useDispatch();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let disposed = false;
    let created: SceneController | null = null;
    el.popupDisabled = true;
    // Rendering quality follows the viewer's performance choice. "Balanced"
    // leaves it to the SDK, which picks a profile for the device; forcing
    // "high" renders at full HiDPI resolution, which is slow on many laptops.
    const performance = settingsRef.current.display.performance;
    if (performance === "fast") el.qualityProfile = "low";
    else if (performance === "detailed") el.qualityProfile = "high";
    created = new SceneController(
      data,
      settingsRef.current,
      slot === "primary" ? (camera) => dispatch({ type: "camera-settled", camera }) : undefined,
      slot === "primary" ? (text) => dispatch({ type: "toast", text }) : undefined,
    );
    el.map = created.map;
    void el.viewOnReady().then(() => {
      if (disposed || !created) return;
      const view = el.view as SceneView;
      view.constraints.altitude = { min: 15, max: 120_000 };
      view.highlights.removeAll();
      view.highlights.add(new HighlightOptions({ name: "default", color: "#E8B76B", haloOpacity: 0.95, fillOpacity: 0.18 }));
      created.attach(view);
      registerController(slot, created);
      setController(created);
      onReady?.(created);
    });
    const onClick = (event: Event) => {
      const detail = (event as CustomEvent<{ x: number; y: number }>).detail;
      const active = created;
      if (!active || !detail) return;
      void active.hitTest({ x: detail.x, y: detail.y }).then((hit) => {
        if (!hit) return;
        const eventId = hit.attributes.event_id;
        if ((hit.layer === "events" || hit.layer === "trail") && typeof eventId === "string") {
          dispatch({ type: "select-event", id: eventId });
          dispatch({ type: "camera-request", request: { kind: "event", eventId } });
        } else {
          dispatch({ type: "select-feature", feature: { layer: hit.layer, attributes: hit.attributes } });
        }
      });
    };
    el.addEventListener("arcgisViewClick", onClick);
    return () => {
      disposed = true;
      el.removeEventListener("arcgisViewClick", onClick);
      created?.destroy();
      registerController(slot, null);
    };
    // The controller is created once per mounted scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, slot]);

  useEffect(() => {
    controller?.update(settings);
  }, [controller, settings]);

  return { ref, controller };
}

export function SceneHost({ data }: { data: AppData }) {
  const state = useAppState();
  const comparing = state.compareYear !== null;
  const primarySettings = useMemo(() => toSceneSettings(state, data, state.year), [state, data]);
  const compareSettings = useMemo(
    () => toSceneSettings({ ...state, selectedEventId: null }, data, state.compareYear ?? state.year),
    [state, data],
  );
  const primary = useSceneController("primary", data, primarySettings);

  // Camera requests are executed by the primary controller.
  const lastNonce = useRef(0);
  useEffect(() => {
    const req = state.cameraRequest;
    if (!req || !primary.controller || req.nonce === lastNonce.current) return;
    lastNonce.current = req.nonce;
    void primary.controller.flyTo(req);
  }, [state.cameraRequest, primary.controller]);

  // Initial camera when there was no request in the URL.
  const initialised = useRef(false);
  useEffect(() => {
    if (!primary.controller || initialised.current) return;
    initialised.current = true;
    if (!state.cameraRequest) void primary.controller.flyTo({ kind: "era", year: state.year });
  }, [primary.controller, state.cameraRequest, state.year]);

  const in1798 = state.tour?.id === "tour-1798" || state.trailMode;
  return (
    <div className={`scene-stage${comparing ? " compare" : ""}`}>
      <div className="scene-pane">
        <arcgis-scene ref={primary.ref} aria-label={`3D reconstruction of Belfast in ${formatDecimalYear(state.year)}`} />
        {comparing ? <div className="pane-year">{formatDecimalYear(state.year)}</div> : null}
      </div>
      {comparing ? <ComparePane data={data} settings={compareSettings} primary={primary.controller} /> : null}
      <div className={`scene-grade${in1798 ? " amber" : ""}`} aria-hidden="true" />
    </div>
  );
}

function ComparePane({ data, settings, primary }: { data: AppData; settings: SceneSettings; primary: SceneController | null }) {
  const compare = useSceneController("compare", data, settings);
  useEffect(() => {
    const a = primary;
    const b = compare.controller;
    if (!a || !b) return;
    const viewA = a.view;
    const viewB = b.view;
    viewB.camera = viewA.camera.clone();
    let syncing = false;
    const sync = (from: SceneView, to: SceneView) =>
      reactiveUtils.watch(
        () => from.camera,
        (camera) => {
          if (syncing || !(from.interacting || from.animation)) return;
          syncing = true;
          to.camera = camera.clone();
          syncing = false;
        },
      );
    const handles = [sync(viewA, viewB), sync(viewB, viewA)];
    return () => handles.forEach((h) => h.remove());
  }, [primary, compare.controller]);
  return (
    <div className="scene-pane">
      <arcgis-scene ref={compare.ref} aria-label={`Comparison view of Belfast in ${formatDecimalYear(settings.year)}`} />
      <div className="pane-year" style={{ color: "var(--amber)" }}>{formatDecimalYear(settings.year)}</div>
    </div>
  );
}

/** Decimal year for an event start (helper for components). */
export function eventYear(date: string): number {
  return toDecimalYear(date);
}
