/**
 * Application state: a single reducer shared through React context, with
 * shareable fields mirrored into the URL.
 */
import { createContext, useContext, useEffect, useReducer, useRef, type Dispatch, type ReactNode } from "react";
import { TIMELINE_END, TIMELINE_START } from "../data/eras";
import { decodeState, encodeState, type BasemapId, type CameraState, type ShareableState, type ViewMode } from "../engine/urlState";
import type { CameraRequest } from "../map/SceneController";
import { loadDisplayPrefs, saveDisplayPrefs, type DisplayPrefs } from "../map/layerStyles";

export type Speed = 0.5 | 1 | 2 | 4;
export type MobileSheet = "none" | "era" | "story" | "layers";

export interface Toast {
  id: number;
  text: string;
  eventId?: string;
}

export interface FeatureSelection {
  layer: string;
  attributes: Record<string, unknown>;
}

export interface AppState {
  year: number;
  playing: boolean;
  speed: Speed;
  compareYear: number | null;
  viewMode: ViewMode;
  basemap: BasemapId;
  overlayId: string | null;
  overlayOpacity: number;
  modernOpacity: number;
  historicOpacity: number;
  hiddenLayers: string[];
  selectedEventId: string | null;
  selectedFeature: FeatureSelection | null;
  tour: { id: string; step: number } | null;
  trailMode: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  askOpen: boolean;
  aboutOpen: boolean;
  settingsOpen: boolean;
  stylesOpen: boolean;
  introOpen: boolean;
  /** Layer colours, transparency, lighting and performance (saved in this browser). */
  display: DisplayPrefs;
  /** False once the present-day buildings failed to load (the model then stays on screen). */
  modernAvailable: boolean;
  mobileSheet: MobileSheet;
  reducedMotion: boolean;
  camera: CameraState | null;
  cameraRequest: (CameraRequest & { nonce: number }) | null;
  announcement: string;
  toasts: Toast[];
}

export type Action =
  | { type: "set-year"; year: number }
  | { type: "play"; playing: boolean }
  | { type: "speed"; speed: Speed }
  | { type: "compare"; year: number | null }
  | { type: "view-mode"; mode: ViewMode }
  | { type: "basemap"; basemap: BasemapId }
  | { type: "overlay"; id: string | null }
  | { type: "overlay-opacity"; value: number }
  | { type: "modern-opacity"; value: number }
  | { type: "historic-opacity"; value: number }
  | { type: "toggle-layer"; id: string }
  | { type: "select-event"; id: string | null }
  | { type: "select-feature"; feature: FeatureSelection | null }
  | { type: "tour"; tour: { id: string; step: number } | null }
  | { type: "trail"; on: boolean }
  | { type: "panel"; panel: "left" | "right" | "ask" | "about" | "settings" | "styles" | "intro"; open: boolean }
  | { type: "display"; display: DisplayPrefs }
  | { type: "modern-unavailable" }
  | { type: "sheet"; sheet: MobileSheet }
  | { type: "reduced-motion"; value: boolean }
  | { type: "camera-settled"; camera: CameraState }
  | { type: "camera-request"; request: CameraRequest }
  | { type: "announce"; text: string }
  | { type: "toast"; text: string; eventId?: string }
  | { type: "dismiss-toast"; id: number };

let nonce = 0;

function clampYear(year: number): number {
  return Math.min(TIMELINE_END, Math.max(TIMELINE_START, year));
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "set-year":
      return { ...state, year: clampYear(action.year) };
    case "play":
      return { ...state, playing: action.playing };
    case "speed":
      return { ...state, speed: action.speed };
    case "compare":
      return { ...state, compareYear: action.year === null ? null : clampYear(action.year) };
    case "view-mode":
      return { ...state, viewMode: action.mode, cameraRequest: { kind: action.mode === "plan" ? "plan" : "home", nonce: ++nonce } };
    case "basemap":
      return { ...state, basemap: action.basemap };
    case "overlay":
      return { ...state, overlayId: action.id };
    case "overlay-opacity":
      return { ...state, overlayOpacity: action.value };
    case "modern-opacity":
      return { ...state, modernOpacity: action.value };
    case "historic-opacity":
      return { ...state, historicOpacity: action.value };
    case "toggle-layer": {
      const hidden = state.hiddenLayers.includes(action.id) ? state.hiddenLayers.filter((l) => l !== action.id) : [...state.hiddenLayers, action.id];
      return { ...state, hiddenLayers: hidden };
    }
    case "select-event":
      return { ...state, selectedEventId: action.id, selectedFeature: null, rightOpen: action.id ? true : state.rightOpen };
    case "select-feature":
      return { ...state, selectedFeature: action.feature, selectedEventId: null, rightOpen: action.feature ? true : state.rightOpen };
    case "tour":
      return { ...state, tour: action.tour, playing: false, trailMode: action.tour ? state.trailMode : false };
    case "trail":
      return { ...state, trailMode: action.on, playing: false };
    case "panel": {
      const key = { left: "leftOpen", right: "rightOpen", ask: "askOpen", about: "aboutOpen", settings: "settingsOpen", styles: "stylesOpen", intro: "introOpen" }[action.panel] as keyof AppState;
      return { ...state, [key]: action.open };
    }
    case "display":
      return { ...state, display: action.display };
    case "modern-unavailable":
      return state.modernAvailable ? { ...state, modernAvailable: false } : state;
    case "sheet":
      return { ...state, mobileSheet: action.sheet };
    case "reduced-motion":
      return { ...state, reducedMotion: action.value };
    case "camera-settled":
      return { ...state, camera: action.camera };
    case "camera-request":
      return { ...state, cameraRequest: { ...action.request, nonce: ++nonce } };
    case "announce":
      return { ...state, announcement: action.text };
    case "toast":
      return { ...state, toasts: [...state.toasts.slice(-2), { id: ++nonce, text: action.text, eventId: action.eventId }] };
    case "dismiss-toast":
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    default:
      return state;
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function hasSeenIntro(): boolean {
  try {
    return window.localStorage.getItem("belfast-rising:intro") === "seen";
  } catch {
    return false;
  }
}

export function initialState(): AppState {
  const shared: ShareableState = decodeState(window.location.search);
  const hasLinkState = window.location.search.length > 1;
  const desktop = window.matchMedia?.("(min-width: 1100px)").matches ?? true;
  return {
    year: shared.year,
    playing: false,
    speed: 1,
    compareYear: shared.compareYear,
    viewMode: shared.viewMode,
    basemap: shared.basemap,
    overlayId: shared.overlayId,
    overlayOpacity: shared.overlayOpacity,
    modernOpacity: shared.modernOpacity,
    historicOpacity: 1,
    hiddenLayers: shared.hiddenLayers,
    selectedEventId: shared.eventId,
    selectedFeature: null,
    tour: shared.tourId ? { id: shared.tourId, step: shared.tourStep } : null,
    trailMode: false,
    leftOpen: desktop,
    rightOpen: desktop || Boolean(shared.eventId),
    askOpen: false,
    aboutOpen: false,
    settingsOpen: false,
    stylesOpen: false,
    introOpen: !hasLinkState && !hasSeenIntro(),
    display: loadDisplayPrefs(!desktop),
    modernAvailable: true,
    mobileSheet: "none",
    reducedMotion: prefersReducedMotion(),
    camera: shared.camera,
    cameraRequest: shared.camera ? { kind: "camera", camera: shared.camera, nonce: ++nonce } : null,
    announcement: "",
    toasts: [],
  };
}

const StateContext = createContext<AppState | null>(null);
const DispatchContext = createContext<Dispatch<Action> | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  useUrlSync(state);
  useEffect(() => saveDisplayPrefs(state.display), [state.display]);
  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useAppState(): AppState {
  const value = useContext(StateContext);
  if (!value) throw new Error("useAppState must be used inside AppStateProvider");
  return value;
}

export function useDispatch(): Dispatch<Action> {
  const value = useContext(DispatchContext);
  if (!value) throw new Error("useDispatch must be used inside AppStateProvider");
  return value;
}

/** Mirror shareable state into the address bar (debounced, replaceState). */
function useUrlSync(state: AppState): void {
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (state.playing) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const query = encodeState({
        year: state.year,
        camera: state.camera,
        eventId: state.selectedEventId,
        tourId: state.tour?.id ?? null,
        tourStep: state.tour?.step ?? 0,
        compareYear: state.compareYear,
        viewMode: state.viewMode,
        basemap: state.basemap,
        overlayId: state.overlayId,
        overlayOpacity: state.overlayOpacity,
        modernOpacity: state.modernOpacity,
        hiddenLayers: state.hiddenLayers,
      });
      try {
        window.history.replaceState(null, "", `${window.location.pathname}?${query}`);
      } catch (error) {
        console.debug("Could not update the URL", error);
      }
    }, 400);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [state.year, state.camera, state.selectedEventId, state.tour, state.compareYear, state.viewMode, state.basemap, state.overlayId, state.overlayOpacity, state.modernOpacity, state.hiddenLayers, state.playing]);
}

/** Build the share link for the current state. */
export function shareLink(): string {
  return window.location.href;
}
