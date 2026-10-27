/**
 * Typed schema for Belfast Rising's historical data.
 *
 * Field names follow the project brief (snake_case) so that the published
 * JSON/GeoJSON can be consumed by GIS tools without renaming.
 */

/** Strength of evidence for an event or feature. */
export type HistoricalConfidence = "documented" | "probable" | "approximate" | "tradition";

/** How a geometry was obtained. Only "surveyed"/"georeferenced" are measured. */
export type GeometryBasis =
  | "surveyed"
  | "georeferenced"
  | "approximate"
  | "schematic"
  | "illustrative";

export type DatePrecision = "day" | "month" | "year" | "decade" | "century" | "range";

export type LocationPrecision = "building" | "street" | "approximate" | "area" | "town" | "unmapped";

export type InterpretationStatus =
  | "established"
  | "disputed"
  | "competing-dates"
  | "single-source"
  | "tradition-unverified"
  | "estimate";

export type EventCategory =
  | "origins"
  | "civic"
  | "political"
  | "rebellion"
  | "military"
  | "industry"
  | "maritime"
  | "transport"
  | "religion"
  | "culture"
  | "architecture"
  | "conflict"
  | "blitz"
  | "demography"
  | "regeneration"
  | "archaeology"
  | "commemoration";

export type EraId =
  | "origins"
  | "plantation"
  | "georgian"
  | "revolution"
  | "industrial"
  | "metropolis"
  | "shipbuilders"
  | "partition"
  | "conflict"
  | "regeneration";

export type SourceKind = "reference" | "official" | "news" | "secondary" | "dataset" | "image" | "primary";

export interface SourceRecord {
  id: string;
  name: string;
  publisher: string;
  url: string | null;
  kind: SourceKind;
  accessed: string;
  licence?: string;
  notes?: string;
}

/** A competing reading of the evidence (date, place or account). */
export interface Interpretation {
  label: string;
  claim: string;
  source_ids: string[];
}

/** A labelled fact shown in the event's fact table, with its own citations. */
export interface EventDetail {
  label: string;
  value: string;
  source_ids: string[];
}

/** Link to an image or archival item that is not redistributed by the app. */
export interface MediaLink {
  title: string;
  url: string;
  licence?: string;
  creator?: string;
}

export interface CameraHint {
  heading: number;
  tilt: number;
  /** Distance from camera to target in metres. */
  range: number;
  /** Optional scripted approach, e.g. a fly down High Street. */
  approach?: "high-street";
}

/** One historical event, matching the brief's required fields plus extensions. */
export interface HistoricalEvent {
  event_id: string;
  title: string;
  description: string;
  start_date: string;
  end_date: string | null;
  date_precision: DatePrecision;
  /** Decimal year of start_date (derived) — used by the time engine. */
  start_year: number;
  /** Decimal year of end_date, or start_year when there is no end (derived). */
  end_year: number;
  event_category: EventCategory;
  people: string[];
  location_name: string | null;
  historical_location_name: string | null;
  longitude: number | null;
  latitude: number | null;
  geometry_type: "Point" | null;
  location_precision: LocationPrecision;
  /** Radius in metres within which the true position is expected to lie. */
  location_uncertainty_m: number | null;
  location_basis: GeometryBasis | null;
  location_derivation: string | null;
  place_id: string | null;
  historical_confidence: HistoricalConfidence;
  interpretation_status: InterpretationStatus;
  /** Primary citation (first entry of source_ids), as required by the brief. */
  source_name: string;
  source_url: string | null;
  /** All citations. */
  source_ids: string[];
  image_url: string | null;
  image_rights: string | null;
  media_links: MediaLink[];
  "3d_reconstruction_available": boolean;
  related_event_ids: string[];
  timeline_importance: 1 | 2 | 3 | 4 | 5;
  era_id: EraId;
  chapter: "1798" | null;
  interpretations: Interpretation[];
  details: EventDetail[];
  tags: string[];
  content_note: string | null;
  camera: CameraHint | null;
  landmark_id: string | null;
  trail_stop: number | null;
}

export type FeatureKind =
  | "landmark"
  | "street"
  | "entry"
  | "rail"
  | "water"
  | "land"
  | "channel"
  | "envelope"
  | "massing";

/** Temporal fields shared by every time-aware feature. */
export interface TemporalProps {
  /** Year construction began; null when unknown (treated as start_year - 1). */
  build_start: number | null;
  /** Year the feature is complete / first present. */
  start_year: number;
  /** Year the feature ceases to exist; null = still present in 2026. */
  end_year: number | null;
}

export interface LandmarkPartProps extends TemporalProps {
  feature_id: string;
  landmark_id: string;
  name: string;
  phase: number;
  part: number;
  base_m: number;
  height_m: number;
  style: string;
  status: "surviving" | "lost" | "replaced";
  historical_confidence: HistoricalConfidence;
  height_basis: "documented" | "inferred" | "illustrative";
  footprint_basis: string;
  positional_uncertainty_m: number;
  source_ids: string;
  notes: string;
}

/** Compact massing properties (short keys keep the illustrative layer small). */
export interface MassingProps {
  i: number;
  /** build start year */
  b: number;
  /** completion year */
  s: number;
  /** end year (9999 = present) */
  e: number;
  /** height in metres */
  h: number;
  /** style code index into the styles table */
  k: number;
  /** kind: 0 frontage, 1 terrace, 2 industrial */
  t: number;
}

export interface StreetSegmentProps extends TemporalProps {
  feature_id: string;
  street_id: string;
  name: string;
  street_class: string;
  /** "documented" when a source dates the street; otherwise "inferred". */
  date_basis: "documented" | "inferred";
  geometry_basis: GeometryBasis;
  source_ids: string;
  note: string;
  chapter: string;
}

export interface Era {
  id: EraId;
  title: string;
  subtitle: string;
  start: number;
  end: number;
  summary: string;
  camera: { target: [number, number]; heading: number; tilt: number; range: number };
  lighting: { month: number; hour: number };
  weather: "sunny" | "cloudy" | "foggy" | "rainy";
  accent: string;
}

export interface TourStepRef {
  eventId: string;
}

export interface Tour {
  id: string;
  title: string;
  subtitle: string;
  accent: "amber" | "cyan";
  intro: {
    year: number;
    camera: { target: [number, number]; heading: number; tilt: number; range: number };
    title: string;
    text: string;
  };
  steps: string[];
}

export interface PopulationPoint {
  year: number;
  population: number;
  note?: string;
}

export interface HistoricMapOverlay {
  id: string;
  title: string;
  kind: "image" | "service";
  service_type?: "wms" | "wmts" | "map-image" | "imagery" | "tile" | "web-tile" | "configure-me";
  url: string;
  years: [number, number];
  georeference?: { type: "extent"; xmin: number; ymin: number; xmax: number; ymax: number };
  licence: string;
  attribution: string;
  is_historic_source: boolean;
  enabled: boolean;
  setup_note?: string;
  source_ids?: string[];
}

export interface TrailStop {
  order: number;
  place: string;
  event_id: string;
  label: string;
  longitude: number;
  latitude: number;
  uncertainty_m: number;
}

export interface Trail {
  id: string;
  title: string;
  path_basis: string;
  stops: TrailStop[];
  path: [number, number][];
}

/** Manifest written by the data build and read by the app at start-up. */
export interface DataManifest {
  generated: string;
  counts: Record<string, number>;
  styles: { code: number; id: string; label: string }[];
  fade_to_modern: [number, number];
  /** Latest completion year of any massing block (no block is under construction after it). */
  massing_last_complete?: number;
  /**
   * Reconstruction phases shown on the timeline. `handover_field` names the
   * massing attribute holding each block's handover year; older data builds
   * lack it, and the scene then keeps every block until the handover ends.
   */
  phases?: {
    clearance: [number, number];
    redevelopment: [number, number] | null;
    handover: [number, number];
    handover_field?: "r";
  };
  footprint: { year: number; area_km2: number }[];
  population: { series: PopulationPoint[]; alternates: { year: number; population: number; label: string }[]; source_ids: string[] };
  street_geometry_source: "schematic" | "openstreetmap";
  /** "digitised" when data/extents/ supplied dated built-up extents. */
  extent_source?: "schematic" | "digitised";
  extent_years?: number[];
  lost_entries: { name: string; note: string; source_ids: string[] }[];
}
