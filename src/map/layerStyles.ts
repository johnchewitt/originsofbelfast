/**
 * Display preferences: layer colours and transparency, lighting and the
 * performance mode. Pure data and helpers (no ArcGIS imports) so they can be
 * unit-tested and stored in the browser.
 */

export type MassingColourMode = "period" | "single";
export type EdgeStyle = "none" | "subtle" | "sketch";
export type LightingMode = "period" | "clear" | "even";
export type PerformanceMode = "fast" | "balanced" | "detailed";

export interface ColourOpacity {
  colour: string;
  /** 0–1, multiplied by the master "historic reconstruction" slider for historic layers. */
  opacity: number;
}

export interface MassingStyle {
  mode: MassingColourMode;
  /** Colour used in "single" mode. */
  single: string;
  /** Colour per architectural period (keys follow growth.json styles). */
  periods: Record<string, string>;
  /** 0.5 (darker) – 1.8 (lighter). */
  brightness: number;
  opacity: number;
  edges: EdgeStyle;
}

export interface LandmarkStyle {
  surviving: string;
  lost: string;
  replaced: string;
  opacity: number;
}

export interface LayerStyles {
  massing: MassingStyle;
  landmarks: LandmarkStyle;
  streets: ColourOpacity;
  water: ColourOpacity;
  envelope: ColourOpacity;
  land: ColourOpacity;
  rail: ColourOpacity;
  modern: ColourOpacity;
}

export interface DisplayPrefs {
  version: 1;
  preset: PresetId | "custom";
  layers: LayerStyles;
  lighting: LightingMode;
  performance: PerformanceMode;
}

export type PresetId = "bright" | "classic" | "monochrome" | "contrast";

/** Brighter period palette (default). */
export const BRIGHT_PERIOD_COLOURS: Record<string, string> = {
  medieval: "#c4b08a",
  plantation: "#dba774",
  georgian: "#efb27e",
  regency: "#f2c896",
  victorian: "#dd8466",
  edwardian: "#f4ead8",
  interwar: "#ddd1b9",
  postwar: "#c3d0d2",
  industrial: "#b4988a",
  terrace: "#d07a5e",
  modern: "#d6ecee",
};

/** The original, muted palette. */
export const CLASSIC_PERIOD_COLOURS: Record<string, string> = {
  medieval: "#8f7f62",
  plantation: "#a77d55",
  georgian: "#c2895c",
  regency: "#c79a6d",
  victorian: "#9c5a43",
  edwardian: "#d9cdb8",
  interwar: "#b9ad97",
  postwar: "#8e9a9c",
  industrial: "#6d5446",
  terrace: "#8a4e3b",
  modern: "#a9c9cc",
};

/** Landmark colours chosen to stand apart from the bright building palette. */
const BRIGHT_LANDMARKS: LandmarkStyle = { surviving: "#c9f4ee", lost: "#ffd166", replaced: "#f4e19c", opacity: 1 };

const BASE_LAYERS: Omit<LayerStyles, "massing"> = {
  landmarks: BRIGHT_LANDMARKS,
  streets: { colour: "#F2E8D5", opacity: 0.9 },
  water: { colour: "#1d6670", opacity: 1 },
  envelope: { colour: "#E8B76B", opacity: 0.8 },
  land: { colour: "#E8B76B", opacity: 1 },
  rail: { colour: "#c9d6d8", opacity: 0.85 },
  modern: { colour: "#49EAD8", opacity: 1 },
};

export const PRESETS: Record<PresetId, { label: string; note: string; layers: LayerStyles }> = {
  bright: {
    label: "Bright",
    note: "Light period colours with crisp outlines (default)",
    layers: {
      ...BASE_LAYERS,
      massing: { mode: "period", single: "#efe4cf", periods: { ...BRIGHT_PERIOD_COLOURS }, brightness: 1, opacity: 1, edges: "subtle" },
    },
  },
  classic: {
    label: "Classic",
    note: "The original muted palette with sketched edges",
    layers: {
      ...BASE_LAYERS,
      landmarks: { surviving: "#F2E8D5", lost: "#E8B76B", replaced: "#c9a46a", opacity: 1 },
      streets: { colour: "#F2E8D5", opacity: 0.75 },
      massing: { mode: "period", single: "#c2895c", periods: { ...CLASSIC_PERIOD_COLOURS }, brightness: 1, opacity: 1, edges: "sketch" },
    },
  },
  monochrome: {
    label: "Monochrome",
    note: "Every building in one pale stone colour",
    layers: {
      ...BASE_LAYERS,
      massing: { mode: "single", single: "#efe4cf", periods: { ...BRIGHT_PERIOD_COLOURS }, brightness: 1, opacity: 1, edges: "subtle" },
    },
  },
  contrast: {
    label: "High contrast",
    note: "Extra-light buildings and white streets on the dark ground",
    layers: {
      ...BASE_LAYERS,
      streets: { colour: "#ffffff", opacity: 1 },
      water: { colour: "#2a8a96", opacity: 1 },
      massing: { mode: "period", single: "#ffffff", periods: { ...BRIGHT_PERIOD_COLOURS }, brightness: 1.35, opacity: 1, edges: "subtle" },
    },
  },
};

export const LIGHTING_OPTIONS: { id: LightingMode; label: string; note: string }[] = [
  { id: "clear", label: "Clear daylight", note: "Midday sun, no weather — easiest to read" },
  { id: "period", label: "Period atmosphere", note: "Each era's light and weather (fog, cloud, evening)" },
  { id: "even", label: "Even light", note: "Flat, shadowless light from every side" },
];

export const PERFORMANCE_OPTIONS: { id: PerformanceMode; label: string; note: string }[] = [
  { id: "fast", label: "Fast", note: "No shadows or edges, still water, fewer updates while playing — for laptops, tablets and phones" },
  { id: "balanced", label: "Balanced", note: "Shadows and outlines; buildings update a few times a second while playing" },
  { id: "detailed", label: "Detailed", note: "Everything on, including buildings rising during construction — needs a good graphics card" },
];

export function defaultDisplayPrefs(narrowScreen = false): DisplayPrefs {
  return {
    version: 1,
    preset: "bright",
    layers: clone(PRESETS.bright.layers),
    lighting: "clear",
    performance: narrowScreen ? "fast" : "balanced",
  };
}

/**
 * Everything that requires new renderers (colours, edges, performance), with
 * opacities left out: opacity changes are applied to the layers directly.
 */
export function styleKey(prefs: DisplayPrefs): string {
  return JSON.stringify(prefs.layers, (key, value: unknown) => (key === "opacity" ? undefined : value)) + prefs.performance;
}

export function applyPreset(prefs: DisplayPrefs, preset: PresetId): DisplayPrefs {
  return { ...prefs, preset, layers: clone(PRESETS[preset].layers) };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColour(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

/** Normalise to "#rrggbb" (lower case), the form colour inputs require. */
export function normalizeHex(hex: string): string {
  const h = hex.replace("#", "").toLowerCase();
  return `#${h.length === 3 ? h.split("").map((c) => c + c).join("") : h}`;
}

function colourOr(value: unknown, fallback: string): string {
  return normalizeHex(isHexColour(value) ? value : fallback);
}

function numberOr(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function colourOpacity(value: unknown, fallback: ColourOpacity): ColourOpacity {
  const v = (value ?? {}) as Partial<ColourOpacity>;
  return { colour: colourOr(v.colour, fallback.colour), opacity: numberOr(v.opacity, fallback.opacity, 0, 1) };
}

/**
 * Validate stored or shared preferences, keeping every valid field and
 * replacing anything missing or malformed with the default.
 */
export function sanitizeDisplayPrefs(raw: unknown, fallback: DisplayPrefs = defaultDisplayPrefs()): DisplayPrefs {
  if (!raw || typeof raw !== "object") return clone(fallback);
  const r = raw as Partial<DisplayPrefs>;
  const l = (r.layers ?? {}) as Partial<LayerStyles>;
  const fl = fallback.layers;
  const m = (l.massing ?? {}) as Partial<MassingStyle>;
  const periods: Record<string, string> = { ...fl.massing.periods };
  if (m.periods && typeof m.periods === "object") {
    for (const [key, value] of Object.entries(m.periods)) if (key in periods && isHexColour(value)) periods[key] = normalizeHex(value);
  }
  const lm = (l.landmarks ?? {}) as Partial<LandmarkStyle>;
  return {
    version: 1,
    preset: oneOf(r.preset, ["bright", "classic", "monochrome", "contrast", "custom"] as const, "custom"),
    lighting: oneOf(r.lighting, ["period", "clear", "even"] as const, fallback.lighting),
    performance: oneOf(r.performance, ["fast", "balanced", "detailed"] as const, fallback.performance),
    layers: {
      massing: {
        mode: oneOf(m.mode, ["period", "single"] as const, fl.massing.mode),
        single: colourOr(m.single, fl.massing.single),
        periods,
        brightness: numberOr(m.brightness, fl.massing.brightness, 0.5, 1.8),
        opacity: numberOr(m.opacity, fl.massing.opacity, 0, 1),
        edges: oneOf(m.edges, ["none", "subtle", "sketch"] as const, fl.massing.edges),
      },
      landmarks: {
        surviving: colourOr(lm.surviving, fl.landmarks.surviving),
        lost: colourOr(lm.lost, fl.landmarks.lost),
        replaced: colourOr(lm.replaced, fl.landmarks.replaced),
        opacity: numberOr(lm.opacity, fl.landmarks.opacity, 0, 1),
      },
      streets: colourOpacity(l.streets, fl.streets),
      water: colourOpacity(l.water, fl.water),
      envelope: colourOpacity(l.envelope, fl.envelope),
      land: colourOpacity(l.land, fl.land),
      rail: colourOpacity(l.rail, fl.rail),
      modern: colourOpacity(l.modern, fl.modern),
    },
  };
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Lighten (factor > 1, mixing towards white) or darken (factor < 1, scaling
 * towards black) a colour. A factor of 1 returns the colour unchanged; 2
 * would be white.
 */
export function adjustBrightness(hex: string, factor: number): string {
  const rgb = parseHex(hex);
  if (factor >= 1) {
    const t = Math.min(1, factor - 1);
    return toHex(rgb.map((c) => c + (255 - c) * t) as [number, number, number]);
  }
  const f = Math.max(0, factor);
  return toHex(rgb.map((c) => c * f) as [number, number, number]);
}

/** Linear mix of two colours: t = 0 gives `a`, t = 1 gives `b`. */
export function mixColours(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const k = Math.min(1, Math.max(0, t));
  return toHex([0, 1, 2].map((i) => (ca[i] as number) + ((cb[i] as number) - (ca[i] as number)) * k) as [number, number, number]);
}

/** Effective colour of a massing block of the given period style. */
export function massingColour(style: MassingStyle, period: string): string {
  const base = style.mode === "single" ? style.single : style.periods[period] ?? style.periods.victorian ?? "#c0a080";
  return adjustBrightness(base, style.brightness);
}

/** Relative luminance (WCAG) of a colour, 0–1. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Engine settings implied by a performance mode. */
export interface PerformanceProfile {
  shadows: boolean;
  animatedWater: boolean;
  /** Edge style override (null = use the layer style). */
  edgesOverride: EdgeStyle | null;
  /** Re-render buildings rising during construction (embeds the year in the renderer). */
  constructionAnimation: boolean;
  /** Minimum interval between scene updates while the year changes (ms). */
  updateIntervalMs: number;
  /** Year step at which year-dependent renderers are rebuilt. */
  rendererYearStep: number;
  /** Frames per second at which playback advances the app state. */
  playbackFps: number;
}

export function performanceProfile(mode: PerformanceMode): PerformanceProfile {
  switch (mode) {
    case "fast":
      return { shadows: false, animatedWater: false, edgesOverride: "none", constructionAnimation: false, updateIntervalMs: 260, rendererYearStep: 2, playbackFps: 24 };
    case "detailed":
      return { shadows: true, animatedWater: true, edgesOverride: null, constructionAnimation: true, updateIntervalMs: 110, rendererYearStep: 0.2, playbackFps: 60 };
    default:
      return { shadows: true, animatedWater: true, edgesOverride: null, constructionAnimation: false, updateIntervalMs: 170, rendererYearStep: 1, playbackFps: 30 };
  }
}

export const DISPLAY_STORAGE_KEY = "belfast-rising:display";

export function loadDisplayPrefs(narrowScreen: boolean): DisplayPrefs {
  const fallback = defaultDisplayPrefs(narrowScreen);
  try {
    const raw = window.localStorage.getItem(DISPLAY_STORAGE_KEY);
    return raw ? sanitizeDisplayPrefs(JSON.parse(raw), fallback) : fallback;
  } catch {
    return fallback;
  }
}

export function saveDisplayPrefs(prefs: DisplayPrefs): void {
  try {
    window.localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable (private window, blocked site data) — settings last for this visit only */
  }
}
