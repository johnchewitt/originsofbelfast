import { useEffect, useRef, useState } from "react";
import { useAppState, useDispatch } from "../state/store";
import type { AppData } from "../data/loaders";
import {
  applyPreset,
  defaultDisplayPrefs,
  LIGHTING_OPTIONS,
  massingColour,
  normalizeHex,
  PERFORMANCE_OPTIONS,
  PRESETS,
  type ColourOpacity,
  type DisplayPrefs,
  type EdgeStyle,
  type LayerStyles,
  type MassingStyle,
  type PresetId,
} from "../map/layerStyles";
import { Modal } from "./Dialogs";

/** Wait this long after the last change before re-styling the scene (colour pickers fire continuously). */
const COMMIT_DELAY_MS = 220;

const OTHER_LAYERS: { id: "streets" | "water" | "envelope" | "land" | "rail"; label: string; note: string }[] = [
  { id: "streets", label: "Period streets", note: "Documented and inferred streets (new streets still glow cyan)" },
  { id: "water", label: "Historic water", note: "Mudflats and channels are shades of this colour" },
  { id: "envelope", label: "Built-up envelope", note: "Outline of the schematic growth model" },
  { id: "land", label: "Newly reclaimed land", note: "Highlight for 25 years after reclamation" },
  { id: "rail", label: "Railways", note: "Schematic lines" },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function DisplayDialog({ data }: { data: AppData }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const [draft, setDraft] = useState<DisplayPrefs>(state.display);
  const [performanceAtLoad] = useState(state.display.performance);
  const timer = useRef<number | null>(null);

  // Keep the draft in step with changes made elsewhere (and with commits).
  useEffect(() => setDraft(state.display), [state.display]);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  if (!state.stylesOpen) return null;

  const commit = (next: DisplayPrefs, immediate = false) => {
    setDraft(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (immediate) dispatch({ type: "display", display: next });
    else timer.current = window.setTimeout(() => dispatch({ type: "display", display: next }), COMMIT_DELAY_MS);
  };
  const d = draft;
  const setLayers = (patch: Partial<LayerStyles>) => commit({ ...d, preset: "custom", layers: { ...d.layers, ...patch } });
  const setMassing = (patch: Partial<MassingStyle>) => setLayers({ massing: { ...d.layers.massing, ...patch } });
  const setSimple = (id: (typeof OTHER_LAYERS)[number]["id"] | "modern", patch: Partial<ColourOpacity>) =>
    setLayers({ [id]: { ...d.layers[id], ...patch } } as Partial<LayerStyles>);
  const close = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      dispatch({ type: "display", display: draft });
    }
    dispatch({ type: "panel", panel: "styles", open: false });
  };
  const m = d.layers.massing;
  const periods = data.manifest.styles.filter((s) => s.id in m.periods);
  const fast = d.performance === "fast";

  return (
    <Modal title="Colours, lighting & performance" labelledBy="styles-title" onClose={close}>
      <section className="section" aria-labelledby="preset-title">
        <div className="section-title" id="preset-title"><span>Presets</span></div>
        <div className="chips">
          {(Object.keys(PRESETS) as PresetId[]).map((id) => (
            <button key={id} className="chip" aria-pressed={d.preset === id} title={PRESETS[id].note} onClick={() => commit(applyPreset(d, id), true)}>
              {PRESETS[id].label}
            </button>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="massing-style-title">
        <div className="section-title" id="massing-style-title"><span>Building massing</span><span>illustrative</span></div>
        <div className="seg" role="radiogroup" aria-label="Building colours">
          <button role="radio" aria-checked={m.mode === "period"} onClick={() => setMassing({ mode: "period" })}>Colour by period</button>
          <button role="radio" aria-checked={m.mode === "single"} onClick={() => setMassing({ mode: "single" })}>One colour</button>
        </div>
        {m.mode === "period" ? (
          <div className="swatch-grid">
            {periods.map((p) => (
              <label key={p.id} className="swatch-pick">
                <input type="color" value={normalizeHex(m.periods[p.id] ?? "#c0a080")} aria-label={`${p.label} colour`}
                  onChange={(e) => setMassing({ periods: { ...m.periods, [p.id]: e.target.value } })} />
                <span className="swatch-preview" style={{ background: massingColour(m, p.id) }} aria-hidden="true" />
                <span>{p.label}</span>
              </label>
            ))}
          </div>
        ) : (
          <label className="swatch-pick single">
            <input type="color" value={normalizeHex(m.single)} aria-label="Building colour" onChange={(e) => setMassing({ single: e.target.value })} />
            <span className="swatch-preview" style={{ background: massingColour(m, "georgian") }} aria-hidden="true" />
            <span>Building colour</span>
          </label>
        )}
        <div className="slider-row">
          <label htmlFor="m-bright"><span>Brightness</span><span>{pct(m.brightness)}</span></label>
          <input id="m-bright" className="range" type="range" min={0.5} max={1.8} step={0.05} value={m.brightness}
            onChange={(e) => setMassing({ brightness: Number(e.target.value) })} />
        </div>
        <div className="slider-row">
          <label htmlFor="m-op"><span>Opacity</span><span>{pct(m.opacity)}</span></label>
          <input id="m-op" className="range" type="range" min={0.1} max={1} step={0.05} value={m.opacity}
            onChange={(e) => setMassing({ opacity: Number(e.target.value) })} />
        </div>
        <div className="field-row">
          <label htmlFor="m-edges">Outlines</label>
          <select id="m-edges" value={m.edges} onChange={(e) => setMassing({ edges: e.target.value as EdgeStyle })} disabled={fast}>
            <option value="none">None (fastest)</option>
            <option value="subtle">Subtle</option>
            <option value="sketch">Sketched (slowest)</option>
          </select>
        </div>
        {fast ? <p className="chart-note">Outlines are off in Fast mode.</p> : null}
      </section>

      <section className="section" aria-labelledby="landmark-style-title">
        <div className="section-title" id="landmark-style-title"><span>Landmarks</span><span>dated</span></div>
        <div className="swatch-grid">
          {(["surviving", "lost", "replaced"] as const).map((k) => (
            <label key={k} className="swatch-pick">
              <input type="color" value={normalizeHex(d.layers.landmarks[k])} aria-label={`${k} landmark colour`}
                onChange={(e) => setLayers({ landmarks: { ...d.layers.landmarks, [k]: e.target.value } })} />
              <span className="swatch-preview" style={{ background: d.layers.landmarks[k] }} aria-hidden="true" />
              <span>{k === "surviving" ? "Surviving" : k === "lost" ? "Lost" : "Replaced"}</span>
            </label>
          ))}
        </div>
        <div className="slider-row">
          <label htmlFor="lm-op"><span>Opacity</span><span>{pct(d.layers.landmarks.opacity)}</span></label>
          <input id="lm-op" className="range" type="range" min={0.1} max={1} step={0.05} value={d.layers.landmarks.opacity}
            onChange={(e) => setLayers({ landmarks: { ...d.layers.landmarks, opacity: Number(e.target.value) } })} />
        </div>
      </section>

      <section className="section" aria-labelledby="other-style-title">
        <div className="section-title" id="other-style-title"><span>Other layers</span></div>
        {OTHER_LAYERS.map((l) => (
          <div className="style-row" key={l.id}>
            <input type="color" value={normalizeHex(d.layers[l.id].colour)} aria-label={`${l.label} colour`}
              onChange={(e) => setSimple(l.id, { colour: e.target.value })} />
            <span>
              {l.label}
              <span className="layer-basis">{l.note}</span>
            </span>
            <input className="range" type="range" min={0} max={1} step={0.05} value={d.layers[l.id].opacity} aria-label={`${l.label} opacity`}
              onChange={(e) => setSimple(l.id, { opacity: Number(e.target.value) })} />
            <span className="style-pct">{pct(d.layers[l.id].opacity)}</span>
          </div>
        ))}
        <div className="style-row">
          <input type="color" value={normalizeHex(d.layers.modern.colour)} aria-label="Present-day buildings outline colour"
            onChange={(e) => setSimple("modern", { colour: e.target.value })} />
          <span>
            Present-day buildings
            <span className="layer-basis">Outline colour beneath historic years</span>
          </span>
          <input className="range" type="range" min={0} max={1} step={0.05} value={state.modernOpacity} aria-label="Present-day buildings opacity"
            onChange={(e) => dispatch({ type: "modern-opacity", value: Number(e.target.value) })} />
          <span className="style-pct">{pct(state.modernOpacity)}</span>
        </div>
      </section>

      <section className="section" aria-labelledby="lighting-title">
        <div className="section-title" id="lighting-title"><span>Lighting</span></div>
        <div className="option-list" role="radiogroup" aria-labelledby="lighting-title">
          {LIGHTING_OPTIONS.map((o) => (
            <button key={o.id} className="option" role="radio" aria-checked={d.lighting === o.id} onClick={() => commit({ ...d, lighting: o.id }, true)}>
              <span>{o.label}<small>{o.note}</small></span>
            </button>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="perf-title">
        <div className="section-title" id="perf-title"><span>Performance</span></div>
        <div className="option-list" role="radiogroup" aria-labelledby="perf-title">
          {PERFORMANCE_OPTIONS.map((o) => (
            <button key={o.id} className="option" role="radio" aria-checked={d.performance === o.id} onClick={() => commit({ ...d, performance: o.id }, true)}>
              <span>{o.label}<small>{o.note}</small></span>
            </button>
          ))}
        </div>
        {d.performance !== performanceAtLoad ? (
          <div className="notice cyan" style={{ marginTop: 10 }}>
            <span>Shadows, outlines and update rate have changed already. Rendering resolution changes when the page reloads.</span>
            <button className="btn small" onClick={() => window.location.reload()}>Reload now</button>
          </div>
        ) : null}
      </section>

      <div className="dialog-foot">
        <button className="btn small" onClick={() => commit({ ...defaultDisplayPrefs(!window.matchMedia?.("(min-width: 1100px)").matches), performance: d.performance }, true)}>
          Reset colours and lighting
        </button>
        <span className="chart-note" style={{ margin: 0 }}>Saved in this browser only.</span>
      </div>
    </Modal>
  );
}
