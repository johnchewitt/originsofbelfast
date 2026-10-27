/**
 * Handover from the illustrative model to the present-day city.
 *
 * Between `fade_to_modern[0]` and `fade_to_modern[1]` the generated massing
 * gives way to the real (OpenStreetMap) buildings. Measured on an integrated
 * GPU (Intel UHD 630, ArcGIS Maps SDK 5.1):
 *
 *  - every change to the massing layer's *opacity* stalled the 3D renderer
 *    for 0.3–1.5 s (crossing from opaque to translucent ~1.5 s), so fading
 *    the model on each year tick made the city blink out and back;
 *  - a change to the massing layer-view *filter* cost 0.1–0.3 s;
 *  - the present-day scene layer took opacity changes with no stall.
 *
 * So the massing never fades. Each block carries its own handover year `r`
 * (generated at build time, centre first) and the filter removes it, while
 * the present-day buildings fade in *first* — the scene never empties.
 *
 * Pure functions only (no ArcGIS imports): shared by the data build, the
 * scene controller, the interface and the tests.
 */

export type HandoverWindow = readonly [number, number];

/** Share of the window over which the present-day buildings fade in. */
export const MODERN_FADE_SHARE = 0.4;
/** Share of the window after which illustrative blocks begin to hand over. */
export const RETIRE_START_SHARE = 0.2;
/** Present-day buildings start the handover at this opacity (a faint first appearance, not a pop). */
export const MODERN_FADE_FROM = 0.12;
/** Opacity steps: layers are only re-assigned when a value crosses a step. */
const MODERN_OPACITY_STEP = 0.05;
const DRAPED_OPACITY_STEP = 0.1;
/** Envelope outline opacity once the present-day city has taken over. */
const ENVELOPE_PRESENT_FACTOR = 0.35;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Round to the nearest multiple of `step` (stable decimals, so unchanged values compare equal). */
export function stepValue(value: number, step: number): number {
  return round3(Math.round(value / step) * step);
}

/** Smooth 0→1 ease between two years (clamped). */
export function smoothstep(year: number, [a, b]: readonly [number, number]): number {
  if (b <= a) return year >= b ? 1 : 0;
  const t = clamp01((year - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Years over which the present-day buildings fade in. */
export function modernFadeRange([start, end]: HandoverWindow): [number, number] {
  return [start, start + (end - start) * MODERN_FADE_SHARE];
}

/** Years over which illustrative blocks hand over (and disappear). */
export function retireRange([start, end]: HandoverWindow): [number, number] {
  return [start + (end - start) * RETIRE_START_SHARE, end];
}

/**
 * Handover year for one block: blocks near the centre go first (regeneration
 * began in the core and on the waterfront), with jitter so the edge of the
 * wave is soft rather than a ring. Both inputs are in [0, 1].
 */
export function handoverYear(window: HandoverWindow, distanceShare: number, jitter: number): number {
  const [a, b] = retireRange(window);
  const t = clamp01(0.6 * clamp01(distanceShare) + 0.4 * clamp01(jitter));
  return Math.round((a + t * (b - a)) * 100) / 100;
}

export type HandoverPhase = "model" | "handover" | "present";

export interface HandoverOptions {
  /** The viewer's "present-day city beneath" setting (0–1). */
  modernOpacity: number;
  /** False when the present-day buildings failed to load: the model then stays on screen. */
  modernAvailable: boolean;
  /**
   * False when the present-day buildings are loaded but not drawn (layer
   * switched off, or the 2D plan view): blocks then stay, so the scene does
   * not empty. Defaults to true.
   */
  modernDrawn?: boolean;
}

export interface HandoverState {
  phase: HandoverPhase;
  /** Share of the handover completed, 0–1 (for the interface). */
  progress: number;
  /** Ghost outlines before the handover; solid buildings from its start. */
  modernMode: "ghost" | "solid";
  /** Opacity of the present-day buildings layer (stepped). */
  modernOpacity: number;
  /** Whether the massing filter applies each block's handover year. */
  retireBlocks: boolean;
  /** False once every block has handed over: the layer is then not drawn at all. */
  massingVisible: boolean;
  /** Opacity of the basemap's base layers (stepped). */
  basemapOpacity: number;
  /** Multiplier for the built-up envelope outline (stepped). */
  envelopeFactor: number;
  /** Basemap labels belong to the present-day city. */
  showReferenceLabels: boolean;
}

/** Everything that changes with the year during the handover, in one place. */
export function handoverState(year: number, window: HandoverWindow, options: HandoverOptions): HandoverState {
  const [start, end] = window;
  const progress = end > start ? clamp01((year - start) / (end - start)) : year >= end ? 1 : 0;
  // Before the handover nothing depends on the year: the viewer's settings apply exactly.
  const ghostBase = Math.max(0.12, options.modernOpacity);
  const basemapOpacity = year < start ? ghostBase : stepValue(ghostBase + (1 - ghostBase) * progress, DRAPED_OPACITY_STEP);
  const showReferenceLabels = year >= start || options.modernOpacity >= 0.6;

  if (!options.modernAvailable || year < start) {
    // Before the handover — or with no present-day buildings to hand over to — the whole model stays.
    return {
      phase: "model",
      progress: options.modernAvailable ? progress : 0,
      modernMode: "ghost",
      modernOpacity: options.modernOpacity,
      retireBlocks: false,
      massingVisible: true,
      basemapOpacity,
      envelopeFactor: 1,
      showReferenceLabels,
    };
  }

  // The present-day buildings turn solid at the opacity the viewer chose for
  // them (at least a faint MODERN_FADE_FROM), so 1986 brings no jump, and
  // reach full opacity before the first block steps aside.
  const from = Math.min(1, Math.max(MODERN_FADE_FROM, options.modernOpacity));
  const fadeIn = smoothstep(year, modernFadeRange(window));
  const present = year >= end;
  const drawn = options.modernDrawn !== false;
  return {
    phase: present ? "present" : "handover",
    progress,
    modernMode: "solid",
    modernOpacity: stepValue(from + (1 - from) * fadeIn, MODERN_OPACITY_STEP),
    retireBlocks: drawn,
    massingVisible: !present || !drawn,
    basemapOpacity,
    envelopeFactor: stepValue(1 - (1 - ENVELOPE_PRESENT_FACTOR) * progress, DRAPED_OPACITY_STEP),
    showReferenceLabels,
  };
}

export interface ReconstructionPhases {
  clearance: readonly [number, number];
  redevelopment: readonly [number, number] | null;
  handover: readonly [number, number];
}

/** Reconstruction phases from the data manifest (older builds carry only the handover window). */
export function phasesOf(manifest: {
  fade_to_modern: [number, number];
  phases?: { clearance: [number, number]; redevelopment: [number, number] | null; handover: [number, number] };
}): ReconstructionPhases {
  const [h0] = manifest.fade_to_modern;
  return manifest.phases ?? { clearance: [h0, h0], redevelopment: null, handover: manifest.fade_to_modern };
}

export interface PhaseLabel {
  id: "model" | "redevelopment" | "handover" | "present" | "model-only";
  /** Short label for the timeline readout. */
  label: string;
  /** One sentence for tooltips and screen readers. */
  detail: string;
}

/**
 * What the scene is showing at `year`, in words — so a viewer reads clearance,
 * redevelopment and the handover as intended rather than as a glitch.
 */
export function reconstructionPhase(
  year: number,
  phases: ReconstructionPhases,
  options: { modernAvailable?: boolean; modernDrawn?: boolean } = {},
): PhaseLabel {
  const [hStart, hEnd] = phases.handover;
  if (year >= hStart && options.modernAvailable === false) {
    return {
      id: "model-only",
      label: "Illustrative model · present-day buildings unavailable",
      detail: "Today's buildings could not be loaded, so the illustrative blocks stay on screen instead of handing over.",
    };
  }
  if (year >= hStart && options.modernDrawn === false) {
    return {
      id: "model-only",
      label: "Illustrative model · present-day buildings off",
      detail: "Today's buildings are switched off or hidden in the plan view, so the illustrative blocks stay on screen.",
    };
  }
  if (year >= hEnd) {
    return { id: "present", label: "Present-day buildings", detail: "The buildings shown are today's, from OpenStreetMap; landmarks keep their sourced dates." };
  }
  if (year >= hStart) {
    const pct = Math.round(((year - hStart) / (hEnd - hStart)) * 100);
    return {
      id: "handover",
      label: `Handing over to present-day buildings · ${pct}%`,
      detail: "Today's buildings (OpenStreetMap) fade in while the illustrative blocks step aside, centre first.",
    };
  }
  const [cStart] = phases.clearance;
  const redevelopmentEnd = phases.redevelopment?.[1] ?? phases.clearance[1];
  if (year >= cStart && year < Math.max(redevelopmentEnd, phases.clearance[1])) {
    return {
      id: "redevelopment",
      label: phases.redevelopment ? "Clearance & redevelopment" : "Clearance",
      detail: phases.redevelopment
        ? "Inner-city terraces are cleared and most sites rebuilt as flats or low-rise housing after a few vacant years (illustrative blocks)."
        : "Inner-city terraces are cleared (illustrative blocks).",
    };
  }
  return { id: "model", label: "Illustrative model", detail: "Blocks show where and roughly when the town built up — not individual historic buildings." };
}

/**
 * Where clause for the massing layer: standing in the model at `year` and,
 * during the handover, not yet handed over. Mirrors {@link isMassingShown}.
 */
export function massingWhereClause(year: number, retireBlocks: boolean): string {
  const y = (Math.round(year * 1000) / 1000).toString();
  const base = `(b <= ${y}) AND (e > ${y})`;
  return retireBlocks ? `${base} AND (r > ${y})` : base;
}

/** TypeScript twin of {@link massingWhereClause}. */
export function isMassingShown(f: { b: number; e: number; r?: number }, year: number, retireBlocks: boolean): boolean {
  return f.b <= year && year < f.e && (!retireBlocks || (f.r ?? Number.POSITIVE_INFINITY) > year);
}
