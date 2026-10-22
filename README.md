# Belfast Rising

**The birth, rebellion and transformation of a city** — an interactive 3D historical map of Belfast from the ford on the Lagan to 2026, with a dedicated story mode for *Belfast 1798 — The Streets of Revolution*.

React 19 · TypeScript · Vite · ArcGIS Maps SDK for JavaScript 5.1 (map components) · Calcite Design System · ECharts · GeoJSON. Builds to a static site for GitHub Pages; the optional assistant backend is a separate service.

---

## What it does

- **A city that grows on a timeline.** Drag, play or step the cinematic slider from before 1600 to 2026 (the 1790s get extra room). Streets lengthen, building massing rises and is rebuilt in successive styles, the estuary is reclaimed into quays and the Queen's Island, bridges replace one another, gantries appear and go, and the present-day city fades in beneath as a cyan outline. Geometry really changes: each feature carries construction, completion and removal years, and the scene filters and extrudes them per year.
- **Ten eras**, each with its own camera, light, weather and summary, and **145 sourced events** placed on the timeline and the map.
- **Belfast 1798 mode.** A 30-stop guided story in amber evening light — the founding of the Society of United Irishmen, the meeting places in the entries, the rising in Antrim and Down, McCracken's capture, court-martial and execution at the Market House (with a slow approach down High Street), the wake tradition at the Morning Star, and the burial and later reburial claims — plus an eight-stop **walking trail** from Crown Entry to Clifton Street Cemetery.
- **Evidence on the surface.** Every event shows its evidence level (documented, probable, approximately located, reported tradition) as a distinct marker shape and colour, a dashed uncertainty disc for its position, competing accounts side by side, and numbered citations.
- **Dashboard.** Census population (sourced), urban footprint (labelled schematic), counts and era milestones.
- **Search and Ask.** Search people, places and events. *Ask Belfast Rising* answers the example questions deterministically from the records and moves the map; an optional secure backend can add a generated summary built only from retrieved records.
- **Compare** two years side by side with linked cameras, toggle 2D plan / 3D, choose a basemap, add a historic map overlay with opacity, export a PNG, GeoJSON or CSV, and share a link that restores the year, camera, selection and story.
- **Your look, your speed.** *Colours, lighting & performance* (left panel or settings) offers presets (Bright, Classic, Monochrome, High contrast), building colours by period or a single colour, brightness, outlines, colour and opacity for every layer, three lighting modes (Clear daylight, Period atmosphere, Even light) and three performance modes (Fast, Balanced, Detailed). Choices are saved in the visitor's browser.
- **Accessible.** Keyboard-operable timeline (ARIA slider), focus-trapped dialogs, live announcements, reduced-motion mode (also follows the OS setting), responsive layouts for desktop, tablet and phone.

## How evidence and reconstruction are kept apart

| Layer | What it is | How it is labelled |
|---|---|---|
| Events (`data/curated/events.json`) | Sourced records; every one cites registered sources | Evidence badge + marker shape; disputes and traditions explicit |
| Gazetteer (`places.json`) | Positions from Irish Grid references (NI Buildings Database), published coordinates, excavation records, or estimates — each with derivation text and an uncertainty radius | Dashed uncertainty disc; "approximately located" where appropriate |
| Landmarks (`landmarks.json`) | Dated phases (build, completion, loss) from sources | Dates sourced; outlines and heights marked *illustrative* or *inferred* unless documented |
| Streets, shoreline, envelope | **Schematic** alignments and outlines, drawn by the author for demonstration | "Schematic" in layer names, legends, details and the About dialog |
| Building massing | **Illustrative** blocks generated from the schematic model, plus shipyard sheds that spread across Queen's Island between the sourced start of shipbuilding (1853) and 1912 | "Illustrative model"; no block or shed represents a real building |

Rules the data build enforces: every event, place, landmark, street date and extent cites a registered source; an event with competing dates needs at least two interpretations; anything labelled a tradition must say so in its text; places must fall inside the study area; envelope radii never shrink. No archival photographs or historic maps are bundled — images are linked to their source pages with their licences, and the only overlay shipped is a generated plan clearly marked *NOT A HISTORIC MAP*.

**The street geometry, shorelines, built-up envelope and massing are a demonstration reconstruction.** The pipeline below is how to replace them with evidence.

---

## Quick start

Requires Node.js 20.19+ (22 recommended).

```bash
npm install
npm run dev          # builds the data, then serves http://localhost:5173
```

Other scripts:

| Script | Does |
|---|---|
| `npm run build` | Data build → type-check → production build in `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm test` | Data build, then Vitest (time filtering, geometry visibility, where-clause/predicate agreement, dates, URL state, search, Ask intents, grid conversions, pipeline outputs) |
| `npm run typecheck` | `tsc -b` |
| `npm run data:build` / `data:validate` | Validate curated data and generate `public/data/` (validate-only for CI) |
| `npm run data:osm` | Download OpenStreetMap street centrelines (optional, see below) |
| `npm run assets:copy` | Copy ArcGIS SDK runtime assets into `public/arcgis-assets/` for self-hosting |

### Environment

Copy `.env.example` to `.env.local`. Nothing is required: basemaps, world elevation and the OpenStreetMap 3D Buildings layer load without a key. Every `VITE_` value is compiled into public JavaScript, so **no secret ever goes in one**. If you add `VITE_ARCGIS_API_KEY`, restrict it by HTTP referrer.

---

## Deploying to GitHub Pages

1. Push the repository to GitHub (default branch `main`).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Optionally add repository *variables* (not secrets — they end up in the bundle): `VITE_ARCGIS_API_KEY`, `VITE_ASSISTANT_ENDPOINT`, `VITE_HISTORIC_MAP_SERVICES`, `VITE_ARCGIS_LOCAL_ASSETS`, `FETCH_OSM`.
4. Push to `main`. `.github/workflows/deploy.yml` installs, validates the data, runs the tests, builds and publishes `dist/`.

The site uses a relative base path, so it works at `https://<user>.github.io/<repo>/` without configuration. Set `VITE_BASE_PATH` only for a fixed root. Pull requests run the same build and tests without deploying.

---

## Data pipeline

```
data/curated/*.json  ──►  scripts/build-data.ts  ──►  public/data/*.json|geojson
data/osm/streets.geojson (optional)  ─┘     │
data/extents/*.geojson (optional)  ───┘     └─►  public/maps/illustrative-plan-1791.svg
```

The build validates everything, derives the full event schema (era, location precision, primary citation, decimal years), converts Irish Grid and ITM references to WGS84 (proj4, EPSG:29903 / EPSG:2157), and generates the time-enabled layers. It is deterministic (seeded) and takes a few seconds.

### Curated files

| File | Contents |
|---|---|
| `sources.json` | Every citation: name, publisher, URL, kind, licence notes |
| `places.json` | Gazetteer: `lonlat`, `irish_grid` or `itm`, `uncertainty_m`, `basis`, `derivation`, `source_ids` |
| `events.json` | Events with `date`/`end`/`precision`, `confidence`, `status`, `importance` 1–5, `sources`, optional `interpretations` (competing accounts), `details` (fact rows with citations), `media` (links + licences), `content_note`, `camera`, `trail_stop` |
| `landmarks.json` | Landmarks with dated phases and simple parts (rect, courtyard, circle, deck) |
| `streets.json` | Period streets: `first_evidence` (+ sources), `osm_names` for the OSM join, closures, lost entries |
| `shoreline.json` | Schematic estuary, river, Farset, reclamation stages, channel |
| `transport.json`, `population.json`, `growth.json`, `tours.json`, `trail.json`, `historic-maps.json` | Rail, census series, growth model and massing parameters, stories, trail, overlays |

The generated `events.json` matches the requested schema field for field (`event_id`, `title`, `description`, `start_date`, `end_date`, `date_precision`, `event_category`, `people`, `location_name`, `historical_location_name`, `longitude`, `latitude`, `geometry_type`, `location_precision`, `historical_confidence`, `interpretation_status`, `source_name`, `source_url`, `image_url`, `image_rights`, `3d_reconstruction_available`, `related_event_ids`, `timeline_importance`), plus `source_ids`, `interpretations`, `location_uncertainty_m` and `location_derivation`.

**Adding an event:** register its sources in `sources.json`, add or reuse a place (never invent precise coordinates for a lost building — give an honest `uncertainty_m`, or leave `place` null so it is listed but not mapped), then add the event. `npm run data:validate` reports anything missing.

### Making the reconstruction evidential

**1. Street geometry from OpenStreetMap.**
`npm run data:osm` queries Overpass for named highways in central Belfast and writes `data/osm/streets.geojson`; the next data build matches each curated street by `osm_names` and proximity (250 m) and swaps in OSM geometry while keeping the curated dates and sources. The app then credits OSM (ODbL) automatically. In CI set the variable `FETCH_OSM=true`, or commit a snapshot (remove `data/osm/` from `.gitignore`). Modern alignments are still modern: widened or realigned streets keep their present shape.

**2. Digitised built-up extents.**
Digitise dated extents from the *Irish Historic Towns Atlas: Belfast* (Royal Irish Academy, parts I and II) or the OSNI six-inch editions in QGIS or ArcGIS Pro, export as WGS84 GeoJSON, and place them in `data/extents/` — one or more files of Polygon/MultiPolygon features with:

```json
{ "type": "Feature",
  "properties": { "year": 1834, "source_ids": ["opendatani-osni-6inch"], "note": "OSNI six-inch Ed.1 sheet 61, digitised by …" },
  "geometry": { "type": "Polygon", "coordinates": [ … ] } }
```

From the earliest digitised year the build uses these for the envelope layer, the footprint chart (relabelled *digitised*), and the timing of streets and massing — a point inside extent *k* appears between extents *k−1* and *k*, interpolated by distance from the earlier edge. Before the first extent the schematic envelope is clipped to it; after the last, the schematic envelope extends it. Check the map's licence before redistributing anything derived from it.

**3. Historic map overlays.**
Add a service in `data/curated/historic-maps.json` (or at deploy time in `VITE_HISTORIC_MAP_SERVICES`): `service_type` is `wms`, `wmts`, `map-image`, `imagery`, `tile` or `web-tile`. OpenDataNI lists OSNI historical six-inch editions georeferenced to the Irish Grid; PRONI's Historical Maps viewer is reference-only. For an image you hold the rights to, put it in `public/maps/` with a corner `extent` or control points. Confirm the licence first; where an image cannot be redistributed, link to it instead.

**4. Industrial zones.** `growth.json → massing.yards` fills a reclaimed-land polygon with large sheds spreading out from a seed point between two sourced years (the Queen's Island shipyard ships as the example). Add Workman Clark's yard or the mills of the Falls and Shankill the same way, each with its sources.

**5. Building footprints.** Add landmarks or phases with surveyed footprints (`footprint_basis`, `height_basis` set to `documented`) as they become available; the massing generator keeps out of landmark sites automatically.

---

## Optional assistant backend

`server/assistant-proxy/` is a Cloudflare Worker that keeps the model API key server-side, accepts requests only from your site's origin, and instructs the model to answer solely from the records the app sends, citing event ids and keeping traditions marked. See its README to deploy, then set `VITE_ASSISTANT_ENDPOINT`. Without it, Ask works entirely in the browser.

---

## Project structure

```
src/
  App.tsx, main.tsx          app shell, playback, keyboard, SDK + Calcite registration
  components/                TopBar, LeftPanel, RightPanel, Timeline, FloatingControls,
                             StoryOverlay, AskPanel, Dialogs, Charts, SceneHost, Icon
  engine/                    time.ts (interval filters, Arcade heights), timeline.ts (scale),
                             dates.ts, geo.ts, envelope.ts, search.ts, ask.ts, urlState.ts (+ tests)
  map/                       SceneController.ts (layers, environment, cameras, overlays),
                             layers.ts (renderers), palette.ts, registry.ts
  data/                      eras.ts, loaders.ts
  state/store.tsx            reducer + URL sync
  types/history.ts           data model
scripts/                     build-data.ts, fetch-osm.ts, copy-arcgis-assets.ts, lib/
data/curated/                the sourced dataset
server/assistant-proxy/      optional secure LLM backend
tests/                       pipeline tests
```

## Performance

The scene draws up to ~12,000 extruded blocks plus streets, water and landmarks, so it is built to change as little as possible while time moves:

- **Building heights are static by default.** Heights come from a field, so the renderer never has to be rebuilt as the year changes. (Rebuilding a renderer that embeds the year was measured at ~10× the cost of a filter change; *Detailed* mode still does it, to show buildings rising during construction.)
- **Time is a layer-view filter for buildings.** All blocks load once and the year only changes a filter, instead of reloading features through the layer's definition expression.
- **Small layers change only when something appears or disappears.** Street, water, landmark and envelope filters snap to the dates in their own data, so they stay unchanged between those dates (unit-tested to show exactly the same features).
- **Lighting is reassigned only when it changes**, not on every tick, and shadows, animated water and outlines can be switched off (*Fast*).
- **Playback updates the interface at 24–60 fps** depending on the mode, and the 3D scene a few times a second.
- **Rendering resolution** is left to the SDK in *Balanced*, forced low in *Fast* and high in *Detailed* (applied on reload).

Phones and narrow screens start in *Fast*; desktops in *Balanced*.

## Keyboard

Space play/pause · ← → step (months in the 1790s) · PgUp/PgDn step a decade · `[` `]` previous/next era · `/` search · Esc close.

---

## Known limitations

- Streets, shorelines, the envelope and massing are schematic or illustrative until the pipeline above is fed with digitised data. The OSM download was not run when this repository was assembled (the build environment could not reach Overpass), so street geometry ships schematic.
- Lost meeting places are placed at their entry or street, not at a precise address: the Crown Entry tavern (±45 m), Peggy Barclay's in Sugarhouse Entry and the Morning Star in Pottinger's Entry (±40 m), and the Thatched House on Waring Street (±150 m).
- The present-day buildings and basemaps are live Esri services; if they are unreachable the historic layers still render on a plain ground, and the illustrative massing stays on screen after 1986 instead of handing over to the real city (the app says so in a notice).
- The assistant proxy was written and type-checked but not deployed or exercised here.

## Licences

Code and the curated dataset: MIT (see `LICENSE`). Sources are cited and linked, not copied; photographs are linked with their own licences. Basemaps © Esri and its data providers; present-day buildings © OpenStreetMap contributors (ODbL) via Esri. ArcGIS Maps SDK for JavaScript and Calcite are used under Esri's terms.

## Key sources

The full bibliography (109 entries) is in `data/curated/sources.json` and in the app's *About the evidence* dialog. Principal works include the *Irish Historic Towns Atlas: Belfast* parts I and II (Royal Irish Academy), the Department for Communities NI Buildings Database, excavation reports on excavations.ie, Belfast City Council heritage pages, the Ulster History Circle, and contemporary reporting for recent events.
