import { useCallback, useMemo } from "react";
import { useAppState, useDispatch } from "../state/store";
import type { AppData } from "../data/loaders";
import { ERAS, eraForYear } from "../data/eras";
import { useThrottled } from "../hooks/useThrottled";
import { PopulationChart, FootprintChart } from "./Charts";
import { Icon } from "./Icon";
import { CONFIDENCE_COLOURS } from "../map/palette";
import { massingColour, type LayerStyles } from "../map/layerStyles";

/** Layer list; swatches follow the viewer's chosen colours. */
function layerList(styles: LayerStyles): { id: string; label: string; basis: string; swatch: string }[] {
  return [
    { id: "events", label: "Historical events", basis: "Shape = evidence level", swatch: CONFIDENCE_COLOURS.documented },
    { id: "uncertainty", label: "Positional uncertainty", basis: "Disc radius = how far the position could be out", swatch: "rgba(232,183,107,0.35)" },
    { id: "landmarks", label: "Landmarks", basis: "Dates sourced · outlines illustrative", swatch: styles.landmarks.surviving },
    { id: "massing", label: "Building massing", basis: "Illustrative model", swatch: massingColour(styles.massing, "georgian") },
    { id: "streets", label: "Period streets", basis: "Schematic alignments", swatch: styles.streets.colour },
    { id: "water", label: "Historic water & shoreline", basis: "Schematic", swatch: styles.water.colour },
    { id: "land", label: "New reclaimed land", basis: "Schematic outlines", swatch: styles.land.colour },
    { id: "rail", label: "Railways", basis: "Dates sourced · schematic lines", swatch: styles.rail.colour },
    { id: "envelope", label: "Built-up envelope", basis: "Schematic growth model", swatch: styles.envelope.colour },
    { id: "modern", label: "Present-day buildings", basis: "OpenStreetMap 3D (Esri)", swatch: styles.modern.colour },
  ];
}

function populationAt(series: { year: number; population: number }[], year: number) {
  let best: { year: number; population: number } | null = null;
  for (const p of series) if (p.year <= year) best = p;
  return best;
}

export function LeftPanel({ data }: { data: AppData }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const year = useThrottled(state.year, 160);
  const era = eraForYear(year);
  const eraIndex = ERAS.findIndex((e) => e.id === era.id);
  const census = populationAt(data.manifest.population.series, year);
  const footprint = useMemo(() => {
    let best: { year: number; area_km2: number } | undefined;
    for (const f of data.manifest.footprint) if (f.year <= year) best = f;
    return best;
  }, [data, year]);
  const digitised = data.manifest.extent_source === "digitised";
  const eventsToDate = useMemo(() => data.events.filter((e) => e.start_year <= year).length, [data, year]);
  const milestones = useMemo(
    () => data.events.filter((e) => e.era_id === era.id && (e.timeline_importance >= 3 || e.chapter === "1798")).slice(0, 40),
    [data, era.id],
  );
  const pickYear = useCallback((y: number) => dispatch({ type: "set-year", year: y }), [dispatch]);

  return (
    <aside className={`panel left glass topo${state.leftOpen ? "" : " closed"}`} aria-label="Era information and layers" aria-hidden={!state.leftOpen}>
      <div className="panel-head">
        <span className="kicker">Era {romanise(eraIndex + 1)} · {era.subtitle}</span>
        <button className="btn ghost icon-btn small" onClick={() => dispatch({ type: "panel", panel: "left", open: false })} aria-label="Close era panel">
          <Icon name="chevronLeft" />
        </button>
      </div>
      <div className="panel-body">
        <h2 className="era-title">{era.title}</h2>
        <p className="prose">{era.summary}</p>

        <div className="stats">
          <div className="stat">
            <div className="stat-value">{census ? `${(census.population / 1000).toFixed(census.population < 100000 ? 1 : 0)}k` : "—"}</div>
            <div className="stat-label">Population{census ? ` (${census.year})` : ""}</div>
            {!census ? <div className="stat-note">No reliable count</div> : census.year < 1821 ? <div className="stat-note">early estimate</div> : null}
          </div>
          <div className="stat">
            <div className="stat-value">{footprint ? footprint.area_km2.toFixed(footprint.area_km2 < 10 ? 1 : 0) : "—"}</div>
            <div className="stat-label">km² built-up</div>
            <div className="stat-note">{digitised ? "digitised extents" : "schematic model"}</div>
          </div>
          <div className="stat">
            <div className="stat-value">{eventsToDate}</div>
            <div className="stat-label">Sourced events to date</div>
          </div>
        </div>

        <section className="section" aria-labelledby="pop-title">
          <div className="section-title" id="pop-title">
            <span>Population</span>
            <span>census &amp; estimates</span>
          </div>
          <PopulationChart series={data.manifest.population.series} year={year} onPick={pickYear} />
          <p className="chart-note">Source: Demographics of Belfast (Wakefield, Irish census, NISRA). Boundaries changed in 1853, 1896 and 2015; the 2021 district total was 345,418.</p>
        </section>

        <section className="section" aria-labelledby="fp-title">
          <div className="section-title" id="fp-title">
            <span>Urban footprint</span>
            <span style={{ color: digitised ? "var(--cyan)" : "var(--amber)" }}>{digitised ? "digitised" : "illustrative"}</span>
          </div>
          <FootprintChart series={data.manifest.footprint} year={year} digitised={digitised} />
          <p className="chart-note">
            {digitised
              ? `Area of built-up extents digitised for ${(data.manifest.extent_years ?? []).join(", ")}; other years are interpolated or schematic. See each extent's sources.`
              : "Area of the schematic growth envelope, not of digitised historic extents. Replace via the data pipeline to make this chart evidential."}
          </p>
        </section>

        <section className="section" aria-labelledby="ms-title">
          <div className="section-title" id="ms-title">
            <span>Milestones in this era</span>
            <span>{milestones.length}</span>
          </div>
          <ul className="milestones">
            {milestones.map((e) => (
              <li key={e.event_id}>
                <button
                  className={`milestone${state.selectedEventId === e.event_id ? " active" : ""}${e.start_year > year ? " future" : ""}`}
                  onClick={() => {
                    dispatch({ type: "set-year", year: e.start_year + 0.002 });
                    dispatch({ type: "select-event", id: e.event_id });
                    if (e.longitude !== null) dispatch({ type: "camera-request", request: { kind: "event", eventId: e.event_id } });
                  }}
                >
                  <span className="milestone-year">{Math.floor(e.start_year)}</span>
                  <span className={`glyph ${e.historical_confidence}`} aria-label={e.historical_confidence} />
                  <span className="milestone-title">{e.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="section" aria-labelledby="layers-title">
          <div className="section-title" id="layers-title">
            <span>Layers &amp; evidence</span>
          </div>
          {layerList(state.display.layers).map((l) => (
            <div className="layer-row" key={l.id}>
              <span className="swatch" style={{ background: l.swatch }} aria-hidden="true" />
              <span>
                {l.label}
                <span className="layer-basis">{l.basis}</span>
              </span>
              <calcite-switch
                label={`Show ${l.label}`}
                checked={!state.hiddenLayers.includes(l.id)}
                oncalciteSwitchChange={() => dispatch({ type: "toggle-layer", id: l.id })}
              />
            </div>
          ))}
          <div className="slider-row">
            <label htmlFor="hist-op">
              <span>Historic reconstruction</span>
              <span>{Math.round(state.historicOpacity * 100)}%</span>
            </label>
            <input id="hist-op" className="range" type="range" min={0} max={1} step={0.05} value={state.historicOpacity}
              onChange={(e) => dispatch({ type: "historic-opacity", value: Number(e.target.value) })} />
          </div>
          <div className="slider-row">
            <label htmlFor="mod-op">
              <span>Present-day city beneath</span>
              <span>{Math.round(state.modernOpacity * 100)}%</span>
            </label>
            <input id="mod-op" className="range" type="range" min={0} max={1} step={0.05} value={state.modernOpacity}
              onChange={(e) => dispatch({ type: "modern-opacity", value: Number(e.target.value) })} />
          </div>
          <button className="btn small" style={{ width: "100%", justifyContent: "center", margin: "4px 0 6px" }} onClick={() => dispatch({ type: "panel", panel: "styles", open: true })}>
            <Icon name="layers" /> Colours, lighting &amp; performance
          </button>
          <Legend />
        </section>
      </div>
    </aside>
  );
}

function Legend() {
  return (
    <div className="section" aria-label="Evidence legend">
      <div className="section-title"><span>Evidence key</span></div>
      <div className="layer-row"><span className="glyph documented" /><span>Documented<span className="layer-basis">Primary or authoritative record</span></span><span /></div>
      <div className="layer-row"><span className="glyph probable" /><span>Probable<span className="layer-basis">Reliable secondary account</span></span><span /></div>
      <div className="layer-row"><span className="glyph approximate" /><span>Approximate location<span className="layer-basis">Event documented; place estimated</span></span><span /></div>
      <div className="layer-row"><span className="glyph tradition" /><span>Reported tradition<span className="layer-basis">Later recollection or folklore</span></span><span /></div>
      <p className="chart-note">Period-coloured blocks are illustrative massing. Labelled landmarks with bright outlines have sourced dates; their outlines are illustrative unless stated.</p>
      <div className="layer-row"><span className="legend-band redevelopment" aria-hidden="true" /><span>Clearance &amp; redevelopment<span className="layer-basis">Timeline band · cleared terraces mostly rebuilt after a few vacant years</span></span><span /></div>
      <div className="layer-row"><span className="legend-band handover" aria-hidden="true" /><span>Handover to present-day buildings<span className="layer-basis">Timeline band · today's buildings fade in, then the model steps aside centre first</span></span><span /></div>
    </div>
  );
}

function romanise(n: number): string {
  const map: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  let rest = n;
  for (const [v, s] of map) while (rest >= v) {
    out += s;
    rest -= v;
  }
  return out;
}
