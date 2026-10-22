import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useAppState, useDispatch } from "../state/store";
import type { AppData } from "../data/loaders";
import { buildSearchIndex, search, type SearchResult } from "../engine/search";
import { formatDecimalYear, formatYearNumber } from "../engine/dates";
import { eraForYear } from "../data/eras";
import { BrandMark, Icon } from "./Icon";

export function TopBar({ data }: { data: AppData }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const era = eraForYear(state.year);
  const in1790s = state.year >= 1791 && state.year < 1801;
  return (
    <header className="topbar">
      <button className="brand" onClick={() => dispatch({ type: "panel", panel: "intro", open: true })} aria-label="Belfast Rising — show introduction">
        <BrandMark />
        <span className="brand-text">
          <span className="brand-title">Belfast Rising</span>
          <span className="brand-sub">The birth, rebellion &amp; transformation of a city</span>
        </span>
      </button>
      <div className="topbar-centre glass" aria-live="off">
        <span className="year-big">{formatYearNumber(Math.floor(state.year))}</span>
        {in1790s ? <span className="year-date">{formatDecimalYear(state.year, "month")}</span> : null}
        <span className="era-chip">{era.title}</span>
      </div>
      <div className="topbar-actions">
        <SearchBox data={data} />
        <button className="btn" onClick={() => dispatch({ type: "panel", panel: "right", open: true })} aria-label="Story mode and tours">
          <Icon name="book" />
          <span className="label-hide-sm">Stories</span>
        </button>
        <button className="btn" aria-pressed={state.askOpen} onClick={() => dispatch({ type: "panel", panel: "ask", open: !state.askOpen })} aria-label="Ask Belfast Rising">
          <Icon name="spark" />
          <span className="label-hide-sm">Ask</span>
        </button>
        <button className="btn icon-btn" onClick={() => dispatch({ type: "panel", panel: "settings", open: true })} aria-label="Map settings">
          <Icon name="settings" />
        </button>
        <button className="btn icon-btn" onClick={() => dispatch({ type: "panel", panel: "about", open: true })} aria-label="About the evidence and sources">
          <Icon name="info" />
        </button>
      </div>
    </header>
  );
}

function SearchBox({ data }: { data: AppData }) {
  const dispatch = useDispatch();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [narrow] = useState(() => window.matchMedia?.("(max-width: 760px)").matches ?? false);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const index = useMemo(() => buildSearchIndex(data.events, data.places), [data]);
  const results = useMemo(() => (query.trim().length >= 2 ? search(index, query, 10) : []), [index, query]);

  const choose = (result: SearchResult) => {
    setOpen(false);
    setQuery("");
    if (result.kind === "event") {
      const event = data.eventsById.get(result.id);
      if (!event) return;
      dispatch({ type: "set-year", year: event.start_year + 0.01 });
      dispatch({ type: "select-event", id: event.event_id });
      if (event.longitude !== null) dispatch({ type: "camera-request", request: { kind: "event", eventId: event.event_id } });
    } else if (result.kind === "person") {
      const events = result.eventIds.map((id) => data.eventsById.get(id)).filter((e) => e !== undefined);
      const mapped = events.filter((e) => e.longitude !== null && e.latitude !== null);
      const first = events[0];
      if (first) dispatch({ type: "select-event", id: first.event_id });
      if (mapped.length) dispatch({ type: "camera-request", request: { kind: "fit", points: mapped.map((e) => [e.longitude as number, e.latitude as number]) } });
      dispatch({ type: "announce", text: `${result.label}: ${events.length} events` });
    } else {
      const place = data.placesById.get(result.id);
      if (!place) return;
      const related = data.events.find((e) => e.place_id === place.id);
      if (related) {
        dispatch({ type: "set-year", year: related.start_year + 0.01 });
        dispatch({ type: "select-event", id: related.event_id });
      }
      dispatch({ type: "camera-request", request: { kind: "look", target: [place.lon, place.lat], heading: 20, tilt: 68, range: Math.max(260, place.uncertainty_m * 6) } });
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && results[active]) {
      choose(results[active] as SearchResult);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div className="search">
      <Icon name="search" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
        aria-label="Search places, people and events"
        placeholder={narrow ? "Search" : "Search people, places, events…"}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
      />
      {open && results.length > 0 ? (
        <ul className="search-results glass" role="listbox" id={listId}>
          {results.map((r, i) => (
            <li key={`${r.kind}-${r.id}`} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r)}>
              <span className="result-kind">{r.kind}</span>
              <span>{r.label}</span>
              <span className="result-detail">{r.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
