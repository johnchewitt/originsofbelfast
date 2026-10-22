import { useEffect, useRef, useState } from "react";
import { useAppState, useDispatch } from "../state/store";
import type { AppData } from "../data/loaders";
import type { BasemapId } from "../engine/urlState";
import { getController } from "../map/registry";
import { isEventVisible } from "../engine/time";
import { Icon } from "./Icon";

type PopoverId = "basemap" | "overlay" | "export" | null;

const BASEMAPS: { id: BasemapId; label: string; note: string }[] = [
  { id: "dark", label: "Midnight streets", note: "Esri dark grey canvas" },
  { id: "imagery", label: "Imagery", note: "Esri World Imagery" },
  { id: "topo", label: "Topographic", note: "Esri topographic" },
  { id: "none", label: "No basemap", note: "Terrain only — the historic city alone" },
];

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function FloatingControls({ data }: { data: AppData }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const [open, setOpen] = useState<PopoverId>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const toggle = (id: PopoverId) => setOpen((cur) => (cur === id ? null : id));

  const visibleEvents = () => data.events.filter((e) => isEventVisible(e, state.year));
  const exportGeoJson = () => {
    const features = visibleEvents()
      .filter((e) => e.longitude !== null && e.latitude !== null)
      .map((e) => ({ type: "Feature", geometry: { type: "Point", coordinates: [e.longitude, e.latitude] }, properties: { ...e } }));
    download(`belfast-rising-events-${Math.floor(state.year)}.geojson`, JSON.stringify({ type: "FeatureCollection", features }, null, 2), "application/geo+json");
  };
  const exportCsv = () => {
    const cols = ["event_id", "title", "start_date", "end_date", "date_precision", "event_category", "historical_location_name", "longitude", "latitude", "location_precision", "location_uncertainty_m", "historical_confidence", "interpretation_status", "source_name", "source_url"] as const;
    const rows = visibleEvents().map((e) => cols.map((c) => csvEscape(e[c])).join(","));
    download(`belfast-rising-events-${Math.floor(state.year)}.csv`, [cols.join(","), ...rows].join("\n"), "text/csv");
  };
  const exportImage = async () => {
    const controller = getController();
    if (!controller) return;
    try {
      const url = await controller.screenshot();
      const a = document.createElement("a");
      a.href = url;
      a.download = `belfast-rising-${Math.floor(state.year)}.png`;
      a.click();
    } catch (error) {
      dispatch({ type: "toast", text: "The screenshot could not be created in this browser." });
      console.warn(error);
    }
  };

  return (
    <div className="float-controls" ref={root} role="toolbar" aria-label="Map controls" aria-orientation="vertical">
      <button className="btn icon-btn" aria-pressed={state.viewMode === "plan"} onClick={() => dispatch({ type: "view-mode", mode: state.viewMode === "3d" ? "plan" : "3d" })}
        aria-label={state.viewMode === "3d" ? "Switch to 2D plan view" : "Switch to 3D view"} title={state.viewMode === "3d" ? "2D plan view" : "3D view"}>
        <Icon name={state.viewMode === "3d" ? "square" : "cube"} />
      </button>
      <div style={{ position: "relative" }}>
        <button className="btn icon-btn" aria-expanded={open === "basemap"} onClick={() => toggle("basemap")} aria-label="Basemap" title="Basemap">
          <Icon name="map" />
        </button>
        {open === "basemap" ? (
          <div className="popover glass" role="dialog" aria-label="Basemap">
            <h4>Present-day basemap</h4>
            <div className="option-list" role="radiogroup">
              {BASEMAPS.map((b) => (
                <button key={b.id} className="option" role="radio" aria-checked={state.basemap === b.id} onClick={() => dispatch({ type: "basemap", basemap: b.id })}>
                  <span>{b.label}<small>{b.note}</small></span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div style={{ position: "relative" }}>
        <button className="btn icon-btn" aria-expanded={open === "overlay"} aria-pressed={state.overlayId !== null} onClick={() => toggle("overlay")} aria-label="Historic map overlay" title="Historic map overlay">
          <Icon name="scroll" />
        </button>
        {open === "overlay" ? (
          <div className="popover glass" role="dialog" aria-label="Historic map overlays">
            <h4>Historic map overlay</h4>
            <div className="option-list" role="radiogroup">
              <button className="option" role="radio" aria-checked={state.overlayId === null} onClick={() => dispatch({ type: "overlay", id: null })}>None</button>
              {data.overlays.map((o) => (
                <button key={o.id} className="option" role="radio" aria-checked={state.overlayId === o.id} disabled={!o.enabled || (o.kind === "service" && !o.url)}
                  onClick={() => dispatch({ type: "overlay", id: o.id })} title={o.setup_note ?? o.attribution}>
                  <span>
                    {o.title}
                    <small>{o.enabled && (o.kind === "image" || o.url) ? (o.is_historic_source ? o.attribution : "Not a historic source — demonstration") : "Not configured — see README"}</small>
                  </span>
                </button>
              ))}
            </div>
            {state.overlayId ? (
              <div className="slider-row">
                <label htmlFor="ov-op"><span>Overlay opacity</span><span>{Math.round(state.overlayOpacity * 100)}%</span></label>
                <input id="ov-op" className="range" type="range" min={0} max={1} step={0.05} value={state.overlayOpacity}
                  onChange={(e) => dispatch({ type: "overlay-opacity", value: Number(e.target.value) })} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <button className="btn icon-btn" onClick={() => dispatch({ type: "camera-request", request: { kind: "home" } })} aria-label="Reset camera to this era" title="Reset camera">
        <Icon name="home" />
      </button>
      <div style={{ position: "relative" }}>
        <button className="btn icon-btn" aria-expanded={open === "export"} onClick={() => toggle("export")} aria-label="Export and share" title="Export">
          <Icon name="download" />
        </button>
        {open === "export" ? (
          <div className="popover glass" role="dialog" aria-label="Export">
            <h4>Export &amp; share</h4>
            <div className="option-list">
              <button className="option" onClick={() => void exportImage()}><Icon name="camera" /><span>Screenshot (PNG)<small>Current view</small></span></button>
              <button className="option" onClick={exportGeoJson}><Icon name="download" /><span>Visible events (GeoJSON)<small>With sources and confidence</small></span></button>
              <button className="option" onClick={exportCsv}><Icon name="download" /><span>Visible events (CSV)</span></button>
              <button className="option" onClick={() => { void navigator.clipboard?.writeText(window.location.href); dispatch({ type: "toast", text: "Link copied — it reopens this year, view and selection." }); }}>
                <Icon name="link" /><span>Copy share link</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
