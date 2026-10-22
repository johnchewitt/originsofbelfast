import { Fragment, useMemo } from "react";
import { useAppState, useDispatch } from "../state/store";
import type { AppData } from "../data/loaders";
import type { HistoricalEvent, SourceRecord } from "../types/history";
import { formatEventSpan } from "../engine/dates";
import { CONFIDENCE_LABELS } from "../map/palette";
import { Icon } from "./Icon";

const PRECISION_LABEL: Record<string, string> = {
  building: "Building-level position",
  street: "Street-level position",
  approximate: "Approximate position",
  town: "Town-level position",
  area: "Area",
  unmapped: "Location not mapped",
};

const STATUS_LABEL: Record<string, string> = {
  established: "Established",
  disputed: "Details disputed",
  "competing-dates": "Competing dates",
  "single-source": "Single source",
  "tradition-unverified": "Unverified tradition",
  estimate: "Estimate",
};

export function RightPanel({ data }: { data: AppData }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const event = state.selectedEventId ? data.eventsById.get(state.selectedEventId) : undefined;
  return (
    <aside className={`panel right glass${state.rightOpen ? "" : " closed"}`} aria-label="Stories and event details" aria-hidden={!state.rightOpen}>
      <div className="panel-head">
        <span className="kicker">{event ? "Event" : state.selectedFeature ? "Feature" : "Stories"}</span>
        <div style={{ display: "flex", gap: 6 }}>
          {event || state.selectedFeature ? (
            <button className="btn ghost small" onClick={() => { dispatch({ type: "select-event", id: null }); dispatch({ type: "select-feature", feature: null }); }}>
              All stories
            </button>
          ) : null}
          <button className="btn ghost icon-btn small" onClick={() => dispatch({ type: "panel", panel: "right", open: false })} aria-label="Close panel">
            <Icon name="chevronRight" />
          </button>
        </div>
      </div>
      <div className="panel-body">
        {event ? <EventDetail event={event} data={data} /> : state.selectedFeature ? <FeatureDetail data={data} /> : <StoriesHome data={data} />}
      </div>
    </aside>
  );
}

export function SourceList({ ids, sources }: { ids: string[]; sources: Map<string, SourceRecord> }) {
  return (
    <ol className="sources">
      {ids.map((id) => {
        const s = sources.get(id);
        if (!s) return null;
        return (
          <li key={id} id={`src-${id}`}>
            <span>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a>
              ) : (
                s.name
              )}
              <span className="source-meta">
                {s.publisher} · {s.kind}
                {s.licence ? ` · ${s.licence}` : ""} · consulted {s.accessed}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function citeIndex(all: string[], ids: string[]): string {
  return ids.map((id) => all.indexOf(id) + 1).filter((n) => n > 0).map((n) => `[${n}]`).join("");
}

export function EventDetail({ event, data }: { event: HistoricalEvent; data: AppData }) {
  const dispatch = useDispatch();
  const allSources = useMemo(() => {
    const ids = new Set<string>(event.source_ids);
    for (const d of event.details) d.source_ids.forEach((id) => ids.add(id));
    for (const i of event.interpretations) i.source_ids.forEach((id) => ids.add(id));
    return [...ids];
  }, [event]);
  const related = event.related_event_ids.map((id) => data.eventsById.get(id)).filter((e): e is HistoricalEvent => Boolean(e));

  const goTo = (e: HistoricalEvent) => {
    dispatch({ type: "set-year", year: e.start_year + 0.002 });
    dispatch({ type: "select-event", id: e.event_id });
    if (e.longitude !== null) dispatch({ type: "camera-request", request: { kind: "event", eventId: e.event_id } });
  };

  return (
    <article aria-labelledby="event-title">
      <span className={`kicker${event.chapter === "1798" ? " amber" : ""}`}>{event.event_category}</span>
      <h2 className="event-title" id="event-title">{event.title}</h2>
      <div className="event-date">{formatEventSpan(event.start_date, event.end_date, event.date_precision)}</div>
      {event.historical_location_name ? (
        <div className="event-place">
          <Icon name="pin" className="icon" /> {event.historical_location_name}
          {event.location_name && event.location_name !== event.historical_location_name ? ` — today: ${event.location_name}` : ""}
        </div>
      ) : null}
      <div className="badges">
        <span className={`badge ${event.historical_confidence}`}>
          <span className={`glyph ${event.historical_confidence}`} style={{ marginTop: 0 }} />
          {CONFIDENCE_LABELS[event.historical_confidence]}
        </span>
        <span className="badge neutral">{STATUS_LABEL[event.interpretation_status] ?? event.interpretation_status}</span>
        <span className="badge neutral">
          {PRECISION_LABEL[event.location_precision]}
          {event.location_uncertainty_m ? ` ±${event.location_uncertainty_m} m` : ""}
        </span>
      </div>
      {event.content_note ? <div className="notice"><Icon name="info" />Content note: {event.content_note}</div> : null}
      <div className="prose">
        {event.description.split("\n\n").map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>

      {event.details.length ? (
        <dl className="facts">
          {event.details.map((d) => (
            <Fragment key={d.label}>
              <dt>{d.label}</dt>
              <dd>
                {d.value}
                {d.source_ids.length ? <span className="cite" title="See sources below">{citeIndex(allSources, d.source_ids)}</span> : null}
              </dd>
            </Fragment>
          ))}
        </dl>
      ) : null}

      {event.interpretations.length ? (
        <section className="section">
          <div className="section-title"><span>Competing accounts</span></div>
          <div className="interpretations">
            {event.interpretations.map((i) => (
              <div className="interpretation" key={i.label}>
                <strong>{i.label}</strong>
                {i.claim}
                {i.source_ids.length ? <span className="cite">{citeIndex(allSources, i.source_ids)}</span> : <em> — not confirmed in the sources consulted</em>}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {event.location_derivation ? (
        <div className="notice cyan">
          <Icon name="compass" />
          <span><strong>How this place was located:</strong> {event.location_derivation}</span>
        </div>
      ) : (
        <div className="notice cyan"><Icon name="compass" /><span>No location is mapped for this event because it could not be substantiated from the sources consulted.</span></div>
      )}

      {event.people.length ? (
        <section className="section">
          <div className="section-title"><span>People</span></div>
          <div className="people">
            {event.people.map((p) => (
              <button key={p} className="person" onClick={() => dispatch({ type: "panel", panel: "ask", open: true })} title={`Ask about ${p}`}>
                {p}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {event.media_links.length ? (
        <section className="section">
          <div className="section-title"><span>Photographs &amp; archives (linked, not copied)</span></div>
          {event.media_links.map((m) => (
            <p key={m.url} className="prose" style={{ margin: "0 0 6px" }}>
              <a href={m.url} target="_blank" rel="noopener noreferrer">{m.title} <Icon name="external" className="icon" /></a>
              <span className="source-meta">{[m.creator, m.licence].filter(Boolean).join(" · ")}</span>
            </p>
          ))}
        </section>
      ) : null}

      {related.length ? (
        <section className="section">
          <div className="section-title"><span>Related</span></div>
          <ul className="milestones">
            {related.map((r) => (
              <li key={r.event_id}>
                <button className="milestone" onClick={() => goTo(r)}>
                  <span className="milestone-year">{Math.floor(r.start_year)}</span>
                  <span className={`glyph ${r.historical_confidence}`} />
                  <span className="milestone-title">{r.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="section">
        <div className="section-title"><span>Sources</span><span>{allSources.length}</span></div>
        <SourceList ids={allSources} sources={data.sources} />
      </section>

      <div className="section" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {event.longitude !== null ? (
          <button className="btn small" onClick={() => dispatch({ type: "camera-request", request: { kind: "event", eventId: event.event_id, approach: event.event_id === "rev-execution-1798" ? "high-street" : undefined } })}>
            <Icon name="compass" /> Fly here
          </button>
        ) : null}
        <button className="btn small" onClick={() => void navigator.clipboard?.writeText(window.location.href)}>
          <Icon name="link" /> Copy link
        </button>
      </div>
    </article>
  );
}

function FeatureDetail({ data }: { data: AppData }) {
  const state = useAppState();
  const feature = state.selectedFeature;
  if (!feature) return null;
  const a = feature.attributes;
  const sourceIds = typeof a.source_ids === "string" && a.source_ids ? a.source_ids.split(",") : [];
  const end = Number(a.end_year ?? a.e);
  const fmtEnd = end >= 9999 ? "standing" : String(Math.round(end));

  if (feature.layer === "massing") {
    const style = data.manifest.styles.find((s) => s.code === Number(a.k));
    return (
      <article>
        <h2 className="event-title">Illustrative building</h2>
        <div className="badges"><span className="badge approximate">Illustrative model</span></div>
        <p className="prose">
          This block is part of a generated massing model that shows the pattern of growth — where and roughly when the town built outward and upward. It does not represent a specific historic building.
        </p>
        <dl className="facts">
          <dt>Style period</dt><dd>{style?.label ?? "—"}</dd>
          <dt>In model</dt><dd>{Math.round(Number(a.s))} – {fmtEnd}</dd>
          <dt>Height</dt><dd>{Number(a.h).toFixed(0)} m (illustrative)</dd>
        </dl>
      </article>
    );
  }
  return (
    <article>
      <span className="kicker">{feature.layer}</span>
      <h2 className="event-title">{String(a.name ?? "Feature")}</h2>
      <div className="badges">
        {a.historical_confidence ? <span className={`badge ${String(a.historical_confidence)}`}>{CONFIDENCE_LABELS[a.historical_confidence as keyof typeof CONFIDENCE_LABELS] ?? String(a.historical_confidence)}</span> : null}
        {a.geometry_basis ? <span className="badge neutral">Geometry: {String(a.geometry_basis)}</span> : null}
        {a.date_basis ? <span className="badge neutral">Date: {String(a.date_basis)}</span> : null}
        {a.height_basis ? <span className="badge neutral">Height: {String(a.height_basis)}</span> : null}
      </div>
      <dl className="facts">
        {a.build_start !== undefined ? (<><dt>Construction</dt><dd>{Math.round(Number(a.build_start))} – {Math.round(Number(a.start_year))}</dd></>) : null}
        <dt>Until</dt><dd>{fmtEnd}</dd>
        {a.status ? (<><dt>Status</dt><dd>{String(a.status)}</dd></>) : null}
        {a.footprint_basis ? (<><dt>Footprint</dt><dd>{String(a.footprint_basis)}</dd></>) : null}
        {a.positional_uncertainty_m ? (<><dt>Position</dt><dd>±{String(a.positional_uncertainty_m)} m</dd></>) : null}
      </dl>
      {a.notes || a.note ? <p className="prose">{String(a.notes ?? a.note)}</p> : null}
      {sourceIds.length ? (
        <section className="section">
          <div className="section-title"><span>Sources</span></div>
          <SourceList ids={sourceIds} sources={data.sources} />
        </section>
      ) : null}
    </article>
  );
}

function StoriesHome({ data }: { data: AppData }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const nearby = useMemo(
    () => data.events.filter((e) => Math.abs(e.start_year - state.year) < (state.year > 1790 && state.year < 1801 ? 3 : 25) && e.timeline_importance >= 3).slice(0, 8),
    [data, state.year],
  );
  return (
    <div>
      <div className="story-cards">
        {data.tours.map((t) => (
          <button key={t.id} className={`story-card${t.accent === "amber" ? " amber" : ""}`} onClick={() => dispatch({ type: "tour", tour: { id: t.id, step: -1 } })}>
            {t.accent === "amber" ? <span className="glow" /> : null}
            <span className={`kicker${t.accent === "amber" ? " amber" : ""}`}>Guided story · {t.steps.length} stops</span>
            <h3>{t.title}</h3>
            <p>{t.subtitle}</p>
          </button>
        ))}
        <button className="story-card amber" onClick={() => { dispatch({ type: "trail", on: true }); dispatch({ type: "set-year", year: 1798.54 }); dispatch({ type: "camera-request", request: { kind: "look", target: [-5.9285, 54.6018], heading: 20, tilt: 62, range: 1300 } }); }}>
          <span className="kicker amber">Walking trail · 8 stops</span>
          <h3>{data.trail.title}</h3>
          <p>Crown Entry to Clifton Street Cemetery. The line is a modern walking route, not a reconstructed historic one.</p>
        </button>
      </div>
      {nearby.length ? (
        <section className="section">
          <div className="section-title"><span>Around {Math.floor(state.year)}</span></div>
          <ul className="milestones">
            {nearby.map((e) => (
              <li key={e.event_id}>
                <button className="milestone" onClick={() => { dispatch({ type: "set-year", year: e.start_year + 0.002 }); dispatch({ type: "select-event", id: e.event_id }); if (e.longitude !== null) dispatch({ type: "camera-request", request: { kind: "event", eventId: e.event_id } }); }}>
                  <span className="milestone-year">{Math.floor(e.start_year)}</span>
                  <span className={`glyph ${e.historical_confidence}`} />
                  <span className="milestone-title">{e.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
