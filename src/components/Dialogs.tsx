import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useAppState, useDispatch } from "../state/store";
import type { AppData } from "../data/loaders";
import { SourceList } from "./RightPanel";
import { BrandMark, Icon } from "./Icon";

export function Modal({ title, onClose, children, labelledBy }: { title: string; onClose: () => void; children: ReactNode; labelledBy: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      // Keep keyboard focus inside the dialog.
      const focusable = [...ref.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, calcite-switch, [tabindex]:not([tabindex='-1'])")].filter(
        (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === ref.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal glass topo" role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} ref={ref}>
        <div className="panel-head">
          <h2 id={labelledBy} className="display" style={{ fontSize: 24 }}>{title}</h2>
          <button className="btn ghost icon-btn small" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </div>
  );
}

export function AboutDialog({ data }: { data: AppData }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const grouped = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const s of data.sources.values()) {
      const list = groups.get(s.kind) ?? [];
      list.push(s.id);
      groups.set(s.kind, list);
    }
    return [...groups.entries()];
  }, [data]);
  if (!state.aboutOpen) return null;
  const m = data.manifest;
  return (
    <Modal title="About the evidence" labelledBy="about-title" onClose={() => dispatch({ type: "panel", panel: "about", open: false })}>
      <div className="prose">
        <p>
          Belfast Rising combines a <strong>sourced historical dataset</strong> with a <strong>schematic growth model</strong>. They carry different weights of evidence, and the interface never lets one pass for the other.
        </p>
        <h3 className="display" style={{ fontSize: 19, margin: "14px 0 6px", color: "var(--cream)" }}>What is evidence</h3>
        <p>
          {m.counts.events} events, each citing at least one registered source, with dates at their stated precision and an evidence level: documented, probable, approximately located, or reported tradition. Where accounts disagree — the founding date of the United Irishmen, the age given for McCracken, the date of the Market House — both readings are shown with their sources. Traditions such as the Morning Star wake are labelled as unverified.
        </p>
        <p>
          {m.counts.mapped_events} events are mapped to {m.counts.places} gazetteer places. Every position records how it was derived (Irish Grid references from the NI Buildings Database, published coordinates, excavation records, or estimates) and an uncertainty radius, drawn on the map as a dashed disc. Events whose location cannot be substantiated are not mapped.
        </p>
        <h3 className="display" style={{ fontSize: 19, margin: "14px 0 6px", color: "var(--cream)" }}>What is illustrative</h3>
        <p>
          The building massing ({(m.counts.massing ?? 0).toLocaleString()} generated blocks), the built-up envelope, the shoreline and reclamation outlines and the street alignments are a <em>demonstration reconstruction</em>. They show the pattern of Belfast's growth — outward along its streets, upward through rebuilding, onto land reclaimed from the Lagan — but they are not digitised from historical maps and no single block represents a real building. Street geometry: <strong>{m.street_geometry_source}</strong>. Landmark dates are sourced; their outlines are illustrative unless stated.
        </p>
        <div className="notice cyan">
          <Icon name="scroll" />
          <span>To make the reconstruction evidential, digitise dated extents and footprints from the Irish Historic Towns Atlas (Belfast I and II) and OSNI six-inch editions, then run the data pipeline described in the README.</span>
        </div>
        <h3 className="display" style={{ fontSize: 19, margin: "14px 0 6px", color: "var(--cream)" }}>Images and maps</h3>
        <p>
          No archival images or historic maps are redistributed with the app. Photographs are linked to their source pages with their licences. The overlay labelled "Illustrative plan c.1791" is generated from this project's own model and is not a historic map.
        </p>
        {m.lost_entries.length ? (
          <p>Lost entries not yet georeferenced: {m.lost_entries.map((l) => l.name).join(", ")}.</p>
        ) : null}
      </div>
      <div className="divider" />
      {grouped.map(([kind, ids]) => (
        <section key={kind} className="section">
          <div className="section-title"><span>{kind} sources</span><span>{ids.length}</span></div>
          <SourceList ids={ids} sources={data.sources} />
        </section>
      ))}
      <p className="chart-note" style={{ marginTop: 18 }}>
        Basemaps © Esri and its data providers; present-day buildings © OpenStreetMap contributors (ODbL) via Esri.
        {m.street_geometry_source === "openstreetmap" ? " Street centrelines © OpenStreetMap contributors (ODbL 1.0)." : ""} Data compiled {m.generated}.
      </p>
    </Modal>
  );
}

export function SettingsDialog() {
  const state = useAppState();
  const dispatch = useDispatch();
  if (!state.settingsOpen) return null;
  return (
    <Modal title="Map settings" labelledBy="settings-title" onClose={() => dispatch({ type: "panel", panel: "settings", open: false })}>
      <div className="layer-row">
        <Icon name="compass" />
        <span>Reduce motion<span className="layer-basis">Instant camera moves, no pulsing markers</span></span>
        <calcite-switch label="Reduce motion" checked={state.reducedMotion} oncalciteSwitchChange={() => dispatch({ type: "reduced-motion", value: !state.reducedMotion })} />
      </div>
      <div className="layer-row">
        <Icon name="cube" />
        <span>3D view<span className="layer-basis">Off shows a flat 2D plan from above</span></span>
        <calcite-switch label="3D view" checked={state.viewMode === "3d"} oncalciteSwitchChange={() => dispatch({ type: "view-mode", mode: state.viewMode === "3d" ? "plan" : "3d" })} />
      </div>
      <button className="btn small" style={{ margin: "6px 0 4px" }} onClick={() => { dispatch({ type: "panel", panel: "settings", open: false }); dispatch({ type: "panel", panel: "styles", open: true }); }}>
        <Icon name="layers" /> Colours, lighting &amp; performance…
      </button>
      <div className="slider-row">
        <label htmlFor="s-hist"><span>Historic reconstruction opacity</span><span>{Math.round(state.historicOpacity * 100)}%</span></label>
        <input id="s-hist" className="range" type="range" min={0} max={1} step={0.05} value={state.historicOpacity} onChange={(e) => dispatch({ type: "historic-opacity", value: Number(e.target.value) })} />
      </div>
      <div className="slider-row">
        <label htmlFor="s-mod"><span>Present-day city beneath historic scenes</span><span>{Math.round(state.modernOpacity * 100)}%</span></label>
        <input id="s-mod" className="range" type="range" min={0} max={1} step={0.05} value={state.modernOpacity} onChange={(e) => dispatch({ type: "modern-opacity", value: Number(e.target.value) })} />
      </div>
      <div className="section-title" style={{ marginTop: 20 }}><span>Keyboard</span></div>
      <dl className="facts">
        <dt>Space</dt><dd>Play / pause</dd>
        <dt>← →</dt><dd>Step a year (a month in the 1790s) when the timeline has focus</dd>
        <dt>PgUp / PgDn</dt><dd>Step a decade (a year in the 1790s)</dd>
        <dt>[ and ]</dt><dd>Previous / next era</dd>
        <dt>/</dt><dd>Search</dd>
      </dl>
    </Modal>
  );
}

export function IntroSplash() {
  const state = useAppState();
  const dispatch = useDispatch();
  if (!state.introOpen) return null;
  const close = () => {
    try {
      window.localStorage.setItem("belfast-rising:intro", "seen");
    } catch {
      /* storage unavailable — the splash will show again next time */
    }
    dispatch({ type: "panel", panel: "intro", open: false });
  };
  return (
    <div className="intro" role="dialog" aria-modal="true" aria-labelledby="intro-title">
      <div className="intro-inner">
        <BrandMark className="brand-mark" />
        <h1 className="intro-title" id="intro-title">Belfast Rising</h1>
        <div className="intro-sub">The birth, rebellion and transformation of a city</div>
        <p className="intro-text">
          Watch a ford on the Lagan become a plantation town, a radical Georgian port, Linenopolis, the city of shipbuilders and the city of today — and walk the streets of 1798 with the United Irishmen.
        </p>
        <div className="intro-actions">
          <button className="btn primary" onClick={() => { close(); dispatch({ type: "set-year", year: 1613 }); dispatch({ type: "camera-request", request: { kind: "era", year: 1613 } }); dispatch({ type: "play", playing: true }); }}>
            <Icon name="play" /> Watch Belfast grow
          </button>
          <button className="btn amber" onClick={() => { close(); dispatch({ type: "tour", tour: { id: "tour-1798", step: -1 } }); }}>
            <Icon name="book" /> Belfast 1798 — The Streets of Revolution
          </button>
          <button className="btn" onClick={() => { close(); dispatch({ type: "panel", panel: "about", open: true }); }}>
            <Icon name="info" /> About the evidence
          </button>
        </div>
        <p className="intro-honesty">
          Events and dates are sourced and graded by evidence. Building massing, shorelines and street alignments are a clearly labelled illustrative model.
        </p>
        <button className="btn ghost small" style={{ marginTop: 10 }} onClick={close}>Skip</button>
      </div>
    </div>
  );
}

export function Toasts({ data }: { data: AppData }) {
  const state = useAppState();
  const dispatch = useDispatch();
  useEffect(() => {
    if (!state.toasts.length) return;
    const latest = state.toasts[state.toasts.length - 1];
    if (!latest) return;
    const timer = window.setTimeout(() => dispatch({ type: "dismiss-toast", id: latest.id }), 5200);
    return () => window.clearTimeout(timer);
  }, [state.toasts, dispatch]);
  return (
    <div className="toasts" aria-live="polite">
      {state.toasts.map((t) => (
        <button key={t.id} className="toast glass" onClick={() => {
          dispatch({ type: "dismiss-toast", id: t.id });
          if (t.eventId) {
            const e = data.eventsById.get(t.eventId);
            dispatch({ type: "play", playing: false });
            dispatch({ type: "select-event", id: t.eventId });
            if (e?.longitude !== null) dispatch({ type: "camera-request", request: { kind: "event", eventId: t.eventId } });
          }
        }}>
          {t.eventId ? <span className={`glyph ${data.eventsById.get(t.eventId)?.historical_confidence ?? "documented"}`} style={{ marginTop: 0 }} /> : null}
          {t.text}
        </button>
      ))}
    </div>
  );
}

export function LiveRegion() {
  const state = useAppState();
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {state.announcement}
    </div>
  );
}

export function MobileTabs() {
  const state = useAppState();
  const dispatch = useDispatch();
  return (
    <nav className="mobile-tabs" aria-label="Panels">
      <button className="btn small" aria-pressed={state.leftOpen} onClick={() => { dispatch({ type: "panel", panel: "right", open: false }); dispatch({ type: "panel", panel: "left", open: !state.leftOpen }); }}>
        <Icon name="layers" /> Era &amp; layers
      </button>
      <button className="btn small" aria-pressed={state.rightOpen} onClick={() => { dispatch({ type: "panel", panel: "left", open: false }); dispatch({ type: "panel", panel: "right", open: !state.rightOpen }); }}>
        <Icon name="book" /> Stories
      </button>
    </nav>
  );
}
