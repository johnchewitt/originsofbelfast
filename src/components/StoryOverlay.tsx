import { useEffect, useRef } from "react";
import { useAppState, useDispatch, type Action } from "../state/store";
import type { AppData } from "../data/loaders";
import type { Tour } from "../types/history";
import { formatEventSpan } from "../engine/dates";
import { CONFIDENCE_LABELS } from "../map/palette";
import { Icon } from "./Icon";

/** Animate the year so geometry visibly grows or recedes between stops. */
function useYearAnimator(dispatch: (a: Action) => void, reducedMotion: boolean) {
  const frame = useRef<number | null>(null);
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);
  return (from: number, to: number) => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    const distance = Math.abs(to - from);
    if (reducedMotion || distance < 0.05) {
      dispatch({ type: "set-year", year: to });
      return;
    }
    const duration = Math.min(4200, 900 + Math.sqrt(distance) * 260);
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      dispatch({ type: "set-year", year: from + (to - from) * eased });
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else frame.current = null;
    };
    frame.current = requestAnimationFrame(tick);
  };
}

export function StoryOverlay({ data }: { data: AppData }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const animateYear = useYearAnimator(dispatch, state.reducedMotion);
  const tour = state.tour ? data.tours.find((t) => t.id === state.tour?.id) : undefined;
  const yearRef = useRef(state.year);
  yearRef.current = state.year;

  // Drive the scene whenever the tour step changes.
  const lastStep = useRef<string>("");
  useEffect(() => {
    if (!tour || !state.tour) return;
    const key = `${tour.id}:${state.tour.step}`;
    if (key === lastStep.current) return;
    lastStep.current = key;
    if (state.tour.step < 0) {
      animateYear(yearRef.current, tour.intro.year);
      dispatch({ type: "select-event", id: null });
      dispatch({ type: "camera-request", request: { kind: "look", ...tour.intro.camera } });
      return;
    }
    const event = data.eventsById.get(tour.steps[state.tour.step] ?? "");
    if (!event) return;
    animateYear(yearRef.current, event.start_year + 0.002);
    dispatch({ type: "select-event", id: event.event_id });
    if (event.longitude !== null) {
      dispatch({ type: "camera-request", request: { kind: "event", eventId: event.event_id, approach: event.camera?.approach } });
    }
    dispatch({ type: "announce", text: `${event.title}. ${formatEventSpan(event.start_date, event.end_date, event.date_precision)}.` });
  }, [tour, state.tour, data, dispatch, animateYear]);

  if (state.trailMode) return <TrailCard data={data} />;
  if (!tour || !state.tour) return null;
  return <TourCard tour={tour} step={state.tour.step} data={data} />;
}

function TourCard({ tour, step, data }: { tour: Tour; step: number; data: AppData }) {
  const dispatch = useDispatch();
  const event = step >= 0 ? data.eventsById.get(tour.steps[step] ?? "") : undefined;
  const total = tour.steps.length;
  const go = (s: number) => dispatch({ type: "tour", tour: { id: tour.id, step: Math.max(-1, Math.min(total - 1, s)) } });
  const amber = tour.accent === "amber";
  return (
    <section className={`story glass${amber ? "" : " cyan"}`} aria-live="polite" aria-label={`${tour.title} — story mode`}>
      <div className="story-head">
        <div>
          <span className={`kicker${amber ? " amber" : ""}`}>{tour.title}</span>
          <h2 className="story-title">{event ? event.title : tour.intro.title}</h2>
          {event ? (
            <div className="event-date">{formatEventSpan(event.start_date, event.end_date, event.date_precision)}</div>
          ) : (
            <div className="event-date">{tour.subtitle}</div>
          )}
        </div>
        <button className="btn ghost icon-btn small" onClick={() => dispatch({ type: "tour", tour: null })} aria-label="Exit story">
          <Icon name="close" />
        </button>
      </div>
      {event ? (
        <div className="badges" style={{ margin: "8px 0 0" }}>
          <span className={`badge ${event.historical_confidence}`}>{CONFIDENCE_LABELS[event.historical_confidence]}</span>
          {event.location_uncertainty_m ? <span className="badge neutral">±{event.location_uncertainty_m} m</span> : <span className="badge neutral">Not mapped</span>}
          {event.content_note ? <span className="badge neutral">Content note</span> : null}
        </div>
      ) : null}
      <div className="story-text">{event ? event.description : tour.intro.text}</div>
      <div className="story-nav">
        <button className="btn small" onClick={() => go(step - 1)} disabled={step < 0} aria-label="Previous stop">
          <Icon name="chevronLeft" /> Back
        </button>
        <div className="dots" role="tablist" aria-label="Story stops">
          {tour.steps.map((id, i) => (
            <button key={id} className={`dot${i === step ? " active" : ""}`} role="tab" aria-selected={i === step} aria-label={`Stop ${i + 1}: ${data.eventsById.get(id)?.title ?? id}`} onClick={() => go(i)} />
          ))}
        </div>
        {step < total - 1 ? (
          <button className={`btn small ${amber ? "amber" : "primary"}`} onClick={() => go(step + 1)}>
            {step < 0 ? "Begin" : "Next"} <Icon name="chevronRight" />
          </button>
        ) : (
          <button className="btn small" onClick={() => dispatch({ type: "tour", tour: null })}>Finish</button>
        )}
      </div>
    </section>
  );
}

function TrailCard({ data }: { data: AppData }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const trail = data.trail;
  const activeIndex = trail.stops.findIndex((s) => s.event_id === state.selectedEventId);
  const visit = (index: number) => {
    const stop = trail.stops[index];
    if (!stop) return;
    const event = data.eventsById.get(stop.event_id);
    dispatch({ type: "set-year", year: event && event.start_year > 1790 && event.start_year < 1801 ? event.start_year + 0.002 : 1798.54 });
    dispatch({ type: "select-event", id: stop.event_id });
    const next = trail.stops[index + 1] ?? trail.stops[index - 1];
    const heading = next ? (Math.atan2(next.longitude - stop.longitude, (next.latitude - stop.latitude) * 1.73) * 180) / Math.PI : 0;
    dispatch({ type: "camera-request", request: { kind: "look", target: [stop.longitude, stop.latitude], heading, tilt: 74, range: Math.max(170, stop.uncertainty_m * 4) } });
  };
  return (
    <section className="story glass" aria-label="1798 walking trail">
      <div className="story-head">
        <div>
          <span className="kicker amber">Walking trail</span>
          <h2 className="story-title">{trail.title}</h2>
        </div>
        <button className="btn ghost icon-btn small" onClick={() => dispatch({ type: "trail", on: false })} aria-label="Close trail">
          <Icon name="close" />
        </button>
      </div>
      <ol className="trail-list">
        {trail.stops.map((s, i) => {
          const event = data.eventsById.get(s.event_id);
          return (
            <li key={s.order}>
              <button className={`trail-stop${i === activeIndex ? " active" : ""}`} onClick={() => visit(i)}>
                <span className="trail-num">{s.order}</span>
                <span>
                  {s.label}
                  <span className="layer-basis">{event?.title}</span>
                </span>
                {event ? <span className={`glyph ${event.historical_confidence}`} aria-label={event.historical_confidence} /> : <span />}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="story-nav">
        <span className="chart-note" style={{ margin: 0 }}>The dashed line is an illustrative modern walking route, not a historic path.</span>
        <button className="btn small amber" onClick={() => visit(Math.min(trail.stops.length - 1, activeIndex + 1))}>
          {activeIndex < 0 ? "Start" : "Next stop"} <Icon name="chevronRight" />
        </button>
      </div>
    </section>
  );
}
