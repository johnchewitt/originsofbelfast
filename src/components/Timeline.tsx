import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useAppState, useDispatch, type Speed } from "../state/store";
import type { AppData } from "../data/loaders";
import { ERAS, eraForYear, eraHomeYear } from "../data/eras";
import { AXIS_TICKS, positionToYear, snapYear, yearToPosition } from "../engine/timeline";
import { formatDecimalYear, formatYearNumber } from "../engine/dates";
import { phasesOf, reconstructionPhase } from "../engine/handover";
import { CONFIDENCE_COLOURS } from "../map/palette";
import { Icon } from "./Icon";

/** Axis labels kept on phones (key) and tablets (key + mid). */
const KEY_TICKS = new Set([1613, 1791, 1900, 2026]);
const MID_TICKS = new Set([1700, 1850, 1945, 1998]);
const tickClass = (t: number): string | undefined => (KEY_TICKS.has(t) ? "key mid" : MID_TICKS.has(t) ? "mid" : undefined);

const SPEEDS: Speed[] = [0.5, 1, 2, 4];
const ERA_TINTS = ["rgba(159,183,168,0.10)", "rgba(201,164,106,0.12)", "rgba(232,183,107,0.10)", "", "rgba(183,162,122,0.10)", "rgba(167,182,180,0.10)", "rgba(73,234,216,0.10)", "rgba(143,179,199,0.10)", "rgba(127,167,176,0.10)", "rgba(73,234,216,0.12)"];

export function Timeline({ data }: { data: AppData }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<"primary" | "compare" | null>(null);
  const era = eraForYear(state.year);
  const ticks = useMemo(() => data.events.filter((e) => e.timeline_importance >= 3), [data]);
  const phases = useMemo(() => phasesOf(data.manifest), [data]);
  const phase = reconstructionPhase(state.year, phases, { modernAvailable: state.modernAvailable });
  const bands = useMemo(() => {
    const list: { id: string; from: number; to: number; title: string }[] = [];
    const [c0, c1] = phases.clearance;
    const redevEnd = Math.max(c1, phases.redevelopment?.[1] ?? c1);
    if (redevEnd > c0) list.push({ id: "redevelopment", from: c0, to: redevEnd, title: `${c0}–${Math.round(redevEnd)}: ${phases.redevelopment ? "clearance and redevelopment" : "clearance"} (illustrative blocks)` });
    const [h0, h1] = phases.handover;
    list.push({ id: "handover", from: h0, to: h1, title: `${h0}–${h1}: handover from the illustrative model to present-day buildings` });
    return list;
  }, [phases]);

  const yearFromPointer = (clientX: number): number => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return state.year;
    return snapYear(positionToYear((clientX - rect.left) / rect.width));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return;
    const nearCompare =
      state.compareYear !== null && Math.abs(e.clientX - (rect.left + yearToPosition(state.compareYear) * rect.width)) < 10;
    dragging.current = nearCompare ? "compare" : "primary";
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (state.playing) dispatch({ type: "play", playing: false });
    move(e.clientX);
  };
  const move = (clientX: number) => {
    const y = yearFromPointer(clientX);
    if (dragging.current === "compare") dispatch({ type: "compare", year: y });
    else dispatch({ type: "set-year", year: y });
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) move(e.clientX);
  };
  const onPointerUp = () => {
    dragging.current = null;
  };

  const step = (direction: 1 | -1, big = false) => {
    const y = state.year;
    const inChapter = y >= 1791 && y < 1801;
    const delta = big ? (inChapter ? 1 : 10) : inChapter ? 1 / 12 : y < 1613 ? 10 : 1;
    dispatch({ type: "set-year", year: snapYear(y + direction * delta) });
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        e.preventDefault();
        step(1);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        e.preventDefault();
        step(-1);
        break;
      case "PageUp":
        e.preventDefault();
        step(1, true);
        break;
      case "PageDown":
        e.preventDefault();
        step(-1, true);
        break;
      case "Home":
        e.preventDefault();
        dispatch({ type: "set-year", year: ERAS[0]?.start ?? 600 });
        break;
      case "End":
        e.preventDefault();
        dispatch({ type: "set-year", year: 2026 });
        break;
      default:
    }
  };

  const skipEra = (direction: 1 | -1) => {
    const index = ERAS.findIndex((e) => e.id === era.id);
    const target = ERAS[Math.min(ERAS.length - 1, Math.max(0, index + direction))];
    if (!target) return;
    const year = eraHomeYear(target);
    dispatch({ type: "set-year", year });
    dispatch({ type: "camera-request", request: { kind: "era", year } });
  };

  const pos = yearToPosition(state.year) * 100;
  const phaseText = phase.id === "model" ? "" : `; ${phase.label.toLowerCase()}`;
  const valueText = `${formatDecimalYear(state.year, state.year >= 1791 && state.year < 1801 ? "month" : "year")}, ${era.title}${phaseText}`;

  return (
    <section className="timeline glass" aria-label="Historical timeline">
      <div className="tl-controls">
        <button className="btn icon-btn small" onClick={() => skipEra(-1)} aria-label="Previous era"><Icon name="prev" /></button>
        <button className="play" onClick={() => dispatch({ type: "play", playing: !state.playing })} aria-label={state.playing ? "Pause" : "Play through time"}>
          <Icon name={state.playing ? "pause" : "play"} />
        </button>
        <button className="btn icon-btn small" onClick={() => skipEra(1)} aria-label="Next era"><Icon name="next" /></button>
        <select className="tl-speed" aria-label="Playback speed" value={state.speed} onChange={(e) => dispatch({ type: "speed", speed: Number(e.target.value) as Speed })}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>{s}×</option>
          ))}
        </select>
      </div>

      <div className="tl-track-wrap">
        <div className="tl-readout">
          <strong className="display" style={{ fontSize: 16, color: "var(--cream)" }}>{era.title}</strong>
          <span>{era.subtitle}</span>
          {state.compareYear !== null ? <span style={{ color: "var(--amber)" }}>compare: {formatDecimalYear(state.compareYear)}</span> : null}
          {phase.id !== "model" ? (
            <span className={`tl-phase ${phase.id}`} title={phase.detail}>
              <span className="tl-phase-dot" aria-hidden="true" />
              {phase.label}
            </span>
          ) : null}
        </div>
        <div className="tl-ticks">
          {ticks.map((e) => (
            <button
              key={e.event_id}
              className="tl-tick"
              style={{ left: `${yearToPosition(e.start_year) * 100}%`, height: 4 + e.timeline_importance * 3, background: CONFIDENCE_COLOURS[e.historical_confidence], opacity: e.start_year <= state.year ? 0.95 : 0.4, border: 0, padding: 0 }}
              title={`${formatYearNumber(Math.floor(e.start_year))} — ${e.title}`}
              aria-label={`${formatYearNumber(Math.floor(e.start_year))}: ${e.title}`}
              tabIndex={-1}
              onClick={() => {
                dispatch({ type: "set-year", year: e.start_year + 0.002 });
                dispatch({ type: "select-event", id: e.event_id });
                if (e.longitude !== null) dispatch({ type: "camera-request", request: { kind: "event", eventId: e.event_id } });
              }}
            />
          ))}
        </div>
        <div
          ref={track}
          className="tl-track"
          role="slider"
          tabIndex={0}
          aria-label="Year"
          aria-valuemin={600}
          aria-valuemax={2026}
          aria-valuenow={Math.round(state.year * 100) / 100}
          aria-valuetext={valueText}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKey}
        >
          {ERAS.map((e, i) => {
            const left = yearToPosition(e.start) * 100;
            const width = yearToPosition(e.end) * 100 - left;
            return (
              <div key={e.id} className={`tl-era ${e.id}${e.id === era.id ? " active" : ""}`} style={{ left: `${left}%`, width: `calc(${width}% - 2px)`, background: ERA_TINTS[i] || undefined }}>
                <span>{e.title}</span>
              </div>
            );
          })}
          <div className="tl-fill" style={{ width: `${pos}%` }} />
          {bands.map((b) => {
            const left = yearToPosition(b.from) * 100;
            return (
              <div key={b.id} className={`tl-band ${b.id}`} style={{ left: `${left}%`, width: `${yearToPosition(b.to) * 100 - left}%` }} title={b.title} aria-hidden="true" />
            );
          })}
        </div>
        <div className="tl-head" style={{ left: `${pos}%` }} />
        {state.compareYear !== null ? <div className="tl-head compare" style={{ left: `${yearToPosition(state.compareYear) * 100}%` }} /> : null}
        <div className="tl-axis" aria-hidden="true">
          {AXIS_TICKS.map((t) => (
            <span key={t} className={tickClass(t)} style={{ left: `${yearToPosition(t) * 100}%` }}>{t === 1795 ? "" : t}</span>
          ))}
        </div>
      </div>

      <div className="tl-right">
        <button
          className="btn small"
          aria-pressed={state.compareYear !== null}
          onClick={() => dispatch({ type: "compare", year: state.compareYear === null ? (state.year < 1950 ? Math.min(2026, Math.round(state.year) + 50) : 1900) : null })}
        >
          <Icon name="compare" />
          <span className="label-hide-sm">Compare</span>
        </button>
      </div>
    </section>
  );
}
