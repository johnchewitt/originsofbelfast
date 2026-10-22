import { useEffect, useRef, useState } from "react";
import { AppStateProvider, useAppState, useDispatch } from "./state/store";
import { loadAppData, type AppData } from "./data/loaders";
import { eraForYear } from "./data/eras";
import { eventsStartingBetween } from "./engine/time";
import { playbackRate } from "./engine/timeline";
import { formatDecimalYear } from "./engine/dates";
import { SceneHost } from "./components/SceneHost";
import { TopBar } from "./components/TopBar";
import { LeftPanel } from "./components/LeftPanel";
import { RightPanel } from "./components/RightPanel";
import { Timeline } from "./components/Timeline";
import { FloatingControls } from "./components/FloatingControls";
import { StoryOverlay } from "./components/StoryOverlay";
import { AskPanel } from "./components/AskPanel";
import { AboutDialog, IntroSplash, LiveRegion, MobileTabs, SettingsDialog, Toasts } from "./components/Dialogs";
import { BrandMark, Icon } from "./components/Icon";
import { ERAS, eraHomeYear } from "./data/eras";

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadAppData()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  if (error) {
    return (
      <div className="loading">
        <div className="error-box glass">
          <h1 className="display" style={{ fontSize: 26 }}>The historical data could not be loaded</h1>
          <p className="prose">{error}</p>
          <p className="prose">If you are running locally, run <code>npm run data:build</code> first.</p>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="loading" role="status" aria-label="Loading Belfast Rising">
        <div style={{ textAlign: "center" }}>
          <BrandMark className="brand-mark" />
          <p className="brand-sub" style={{ marginTop: 12 }}>Gathering four centuries…</p>
        </div>
      </div>
    );
  }
  return (
    <AppStateProvider>
      <Shell data={data} />
    </AppStateProvider>
  );
}

function Shell({ data }: { data: AppData }) {
  const state = useAppState();
  const dispatch = useDispatch();
  usePlayback(data);
  useKeyboard();
  useEraAnnouncements();

  return (
    <div className={`shell${state.reducedMotion ? " reduced-motion" : ""}`}>
      <SceneHost data={data} />
      <TopBar data={data} />
      <LeftPanel data={data} />
      {!state.leftOpen ? (
        <button className="btn icon-btn panel-tab left" onClick={() => dispatch({ type: "panel", panel: "left", open: true })} aria-label="Open era panel">
          <Icon name="layers" />
        </button>
      ) : null}
      <RightPanel data={data} />
      {!state.rightOpen ? (
        <button className="btn icon-btn panel-tab right" onClick={() => dispatch({ type: "panel", panel: "right", open: true })} aria-label="Open stories panel">
          <Icon name="book" />
        </button>
      ) : null}
      <FloatingControls data={data} />
      <StoryOverlay data={data} />
      <AskPanel data={data} />
      <MobileTabs />
      <Timeline data={data} />
      <Toasts data={data} />
      <AboutDialog data={data} />
      <SettingsDialog />
      <IntroSplash />
      <LiveRegion />
    </div>
  );
}

/** Advance the year while playing; announce major events as they are reached. */
function usePlayback(data: AppData) {
  const state = useAppState();
  const dispatch = useDispatch();
  const yearRef = useRef(state.year);
  yearRef.current = state.year;
  useEffect(() => {
    if (!state.playing) return;
    const major = data.events.filter((e) => e.timeline_importance >= 4);
    let last = performance.now();
    let year = yearRef.current >= 2026 ? 600 : yearRef.current;
    let frame = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const next = Math.min(2026, year + playbackRate(year, state.speed) * dt);
      for (const e of eventsStartingBetween(major, year, next)) {
        dispatch({ type: "toast", text: `${Math.floor(e.start_year)} — ${e.title}`, eventId: e.event_id });
      }
      year = next;
      dispatch({ type: "set-year", year });
      if (next >= 2026) {
        dispatch({ type: "play", playing: false });
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state.playing, state.speed, data, dispatch]);
}

function useKeyboard() {
  const state = useAppState();
  const dispatch = useDispatch();
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable], [role='slider']")) return;
      const s = stateRef.current;
      if (e.key === " ") {
        e.preventDefault();
        dispatch({ type: "play", playing: !s.playing });
      } else if (e.key === "[" || e.key === "]") {
        const index = ERAS.findIndex((era) => era.id === eraForYear(s.year).id);
        const target2 = ERAS[Math.max(0, Math.min(ERAS.length - 1, index + (e.key === "]" ? 1 : -1)))];
        if (target2) {
          dispatch({ type: "set-year", year: eraHomeYear(target2) });
          dispatch({ type: "camera-request", request: { kind: "era", year: eraHomeYear(target2) } });
        }
      } else if (e.key === "/") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".search input")?.focus();
      } else if (e.key === "Escape") {
        if (s.askOpen) dispatch({ type: "panel", panel: "ask", open: false });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);
}

/** Screen-reader announcement when the era changes (not on every frame). */
function useEraAnnouncements() {
  const state = useAppState();
  const dispatch = useDispatch();
  const era = eraForYear(state.year).id;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const e = eraForYear(state.year);
    dispatch({ type: "announce", text: `${e.title}, ${formatDecimalYear(state.year)}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [era, dispatch]);
}
