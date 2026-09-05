# Rich apartments + map search: design spec

| | |
|---|---|
| **Status** | Approved design, 2026-09-05 (brainstormed and approved) |
| **Goal** | Make each apartment's information rich (show everything we already store, plus attributes we can parse from stored data), show its location on a map, and turn `/properties` into a filter-rich, map-based "investigation" search |
| **Foundation** | One backend data-parsing pass (reparse of already-stored `raw_listings.payload` — **no OLX re-crawl**) feeding three UI pieces: richer detail page, richer filters, map search |
| **Out of scope** | Exact-address geocoding, Telegram-source coords, physical duplicate merge, outreach sending, dark theme (all separate/parked) |

---

## 1. Decisions taken in the brainstorm

| Decision | Choice | Why |
|---|---|---|
| Sequencing | Build all four parts as one milestone (foundation + detail + filters + map) | Owner chose "all together, one push" |
| Map library | **MapLibre GL JS** + **OpenFreeMap** style (free vector tiles, no API key, OSM data covers Tashkent) | Owner chose MapLibre; OpenFreeMap needs no key and the map component is isolated so the provider can be swapped later |
| Map placement | A **View toggle (List ⇄ Map) on the existing `/properties` route**, not a new page | Reuses the filter model, URL state and data for free; `?view=map` makes a filtered map shareable |
| Map layout | **Split**: filters on top, result cards left, map right; hover/click sync between them | Owner chose the split (Zillow/OLX-style) layout |
| Coordinate honesty | Pins are **approximate** (OLX gives a ~2 km area, `show_detailed:false`); render a soft marker + radius circle + an "approximate area" note | The data is neighborhood-precision, not building-precision; must not imply false precision |
| Data source | **Reparse** stored `raw_listings.payload`, no re-crawl | Every needed field is already stored; a reparse path already exists |

---

## 2. Verified data findings (against the real dev DB, not just fixtures)

Confirmed by querying `raw_listings.payload` for all 547 stored OLX listings:

- **Coordinates exist for every listing.** `payload #> '{ad,map}'` is present on 547/547 rows, shaped `{"lat": 41.2637, "lon": 69.2300, "zoom": 13, "radius": 2, "show_detailed": false}`. `radius` is in km; `show_detailed:false` means OLX deliberately gives an approximate area.
- **Human-readable location exists.** `payload #> '{ad,location}'` has `pathName` e.g. `"Ташкентская область, Ташкент, Яккасарайский район"`, plus `cityName`, `regionName`, `districtName`.
- **Rich attributes are stored but unparsed.** `ad.params` carries `house_type` (building type), `furnished`, `repairs` (renovation/condition), `year_of_construction_rent`, `wc` (bathrooms), `kitchen_area`, `ceiling_height`, `near_is`/`more` (amenities), `comission`. The current parser whitelists only `number_of_rooms`, `floor`, `total_floors`, `total_area`.
- **`listings.address_text` is a dead column** — no code path writes it; always NULL.
- Current parser: `backend/app/ingestion/adapters/olx/state.py` (`ad_to_payload`, `_params`, `_price`); `ParsedListing` at `backend/app/ingestion/parse/__init__.py`; rollup in `backend/app/modules/listings/service.py` (`merge_parsed`) and the properties rollup.

---

## 3. Data foundation (backend)

### 3.1 Parser changes
`backend/app/ingestion/adapters/olx/state.py`:
- Parse `ad.map` → `latitude` (float), `longitude` (float), `location_radius_m` (int; `radius` km × 1000), `location_precise` (bool from `show_detailed`).
- Parse `ad.location.pathName` → `location_label` (string). Fall back to `"{cityName}, {districtName}"` when `pathName` absent.
- Widen the param whitelist and normalise:
  - `house_type` → `building_type` (normalised code: `brick` / `panel` / `monolith` / `block` / `other`, mapping the Russian/Uzbek values).
  - `furnished` → `is_furnished` (bool: `Да`/`Ha` → true, `Нет`/`Yo'q` → false, else null).
  - `repairs` → `renovation` (normalised code: `euro` / `designer` / `good` / `average` / `needs_repair` / `other`).
  - `year_of_construction_rent` → `year_built` (int).
  - `wc` → `bathrooms` (int; parse leading integer).
  - Display-only extras (`kitchen_area`, `ceiling_height`, `near_is`, `more`, `comission`) → an `attributes` JSONB bag.
- `ParsedListing` (`ingestion/parse/__init__.py`) gains these fields; `merge_parsed` writes them to the listing columns.

### 3.2 Schema (one Alembic migration)
New nullable columns on **`listings`**: `latitude` (float), `longitude` (float), `location_radius_m` (int), `location_precise` (bool), `location_label` (text), `building_type` (varchar), `is_furnished` (bool), `renovation` (varchar), `year_built` (int), `bathrooms` (int), `attributes` (JSONB, not null default `{}`). The human-readable location lands in the new `location_label` column; the dead `address_text` column is left untouched (parking its removal to avoid an unrelated destructive migration).

Rolled up to **`properties`** (so the list/map can filter and plot one pin per property): `latitude`, `longitude`, `location_radius_m`, `location_label`, `building_type`, `is_furnished`, `renovation`, `year_built`, `bathrooms`. Rollup takes these from the property's representative listing (the same listing the existing rollup uses for district/rooms/price). A partial index on `(latitude, longitude)` for bbox queries.

### 3.3 Backfill
A CLI reparse command (extend the existing reparse path) reads each stored `raw_listings.payload`, re-runs the parser, and updates the listing + property columns. Idempotent; run once after the migration. No network.

---

## 4. Backend API (`/api/v1`)

- Extend `ListingOut` with: `latitude`, `longitude`, `location_radius_m`, `location_precise`, `location_label`, `building_type`, `is_furnished`, `renovation`, `year_built`, `bathrooms`, `attributes`.
- Extend `PropertyRow` and `PropertyDetail` with: `latitude`, `longitude`, `location_radius_m`, `location_label`, `building_type`, `is_furnished`, `renovation`, `year_built`, `bathrooms`.
- Extend `GET /properties` query params: `area_min`, `area_max`, `floor_min`, `floor_max`, `not_first_floor` (bool), `not_top_floor` (bool), `building_type[]`, `furnished` (bool), `renovation[]`, `posted_within` (enum `24h`/`3d`/`7d`), `has_photos` (bool), and bbox `min_lat`/`min_lon`/`max_lat`/`max_lon`. All optional; absent = no filter. Existing filters unchanged.
- New `GET /properties/pins` — accepts the **same** filter params, returns a lightweight array `{id, latitude, longitude, price_usd_min_minor, rooms, status, source_removed}` for **all** matches with coordinates, capped (≈2000, newest first) and un-paginated, for plotting. Rows without coordinates are omitted from pins (still shown in the list).
- Regenerate `backend/openapi.json` and the web client (`api:generate`).

## 5. Richer apartment page (`pages/property`, `widgets/property-header`, `widgets/listings-list`)

Add, from data we already have:
- A **description** card — the full listing text (not shown anywhere today).
- A **location** block: the `location_label` + a **mini-map** (MapLibre) centered on the property's approximate coords, one soft marker + a translucent radius circle + a small "approximate area" caption. Hidden when the property has no coords.
- A **spec grid**: building type · furnished · renovation · year built · bathrooms · floor/total · area. Each cell hidden when null.
- **Posted date** and per-listing detail in `ListingsList`: original-currency price + USD, posted date, owner/agent badge, `location_label`, source link.

## 6. Rich filters (restructured — `features/property/filters`)

Reorganise, not just pile on chips:
- **Primary bar** (always visible): search · district · rooms · price · status.
- **"More filters" popover** (shadcn Popover/Sheet): area range, floor range + "not first floor" / "not top floor" toggles, building type (chips), furnished (tri-state), renovation (chips), year-built range, posted-within, has-photos. A **count badge** shows how many advanced filters are active; a "reset advanced" clears just those.
- All new filters are added to the existing URL-synced Effector model (`$query`, `querySync`, the token parsers) so reload/back/shared-link all restore them, and they feed both the list and the pins request. `posted_within` maps to a server-side `posted_at >=` cutoff.

## 7. Map search view (Map mode of `/properties`)

- A **View toggle** (List ⇄ Map), state carried in the URL as `?view=map` (synced like the other filters; default `list`).
- **List mode:** unchanged (desktop table / mobile cards).
- **Map mode (split):** filters on top; **left** = the existing property **card list** widget (reused), paginated/scroll; **right** = a `widgets/property-map` MapLibre map.
  - Pins come from `GET /properties/pins` (all matches); cards from the paginated `GET /properties`. Both driven by the same `$query`.
  - **Clustering** via MapLibre's native GeoJSON `cluster:true` source (no extra library). Clusters show counts; at high zoom, individual soft price pins.
  - **Sync:** hovering a card highlights its pin (and vice-versa) via a shared `$hoveredId` store; clicking a pin scrolls/highlights its card; clicking a card opens the apartment page.
  - **"Search this area"** toggle: when on, the map's current bounds feed the bbox filter (debounced on move), so panning re-queries pins + cards. When off, the map just displays the current filter's results.
- **Mobile:** the toggle swaps the whole results area between the card list and a full-height map (no side-by-side on narrow screens).

## 8. Frontend architecture & dependencies

- New dep: **`maplibre-gl`** (pinned). No clustering lib (built-in). No `react-map-gl` — a thin FSD wrapper is enough.
- **`shared/ui/map`** — a small imperative React wrapper around a `maplibre-gl` `Map` (props: center, zoom, a GeoJSON source of points, `onBoundsChange`, `hoveredId`, `onPinClick`). Isolates the provider so it can be swapped. Style URL = OpenFreeMap (`https://tiles.openfreemap.org/styles/liberty`), kept in one constant.
- **`widgets/property-map`** — composes `shared/ui/map` with the pins store, clustering config, price-pin rendering and the hover/click sync.
- The property mini-map reuses `shared/ui/map` with a single point and no clustering.
- Effector: a `pins` slice in `entities/property` (fetch effect + `$pins` store) driven by `$query`; `$hoveredId` and `$view` stores in the filters/map feature; `querySync` extended for `view` + the bbox.
- FSD: `steiger.config.ts` gets the same single-consumer `warn` overrides the other feature/widget slices use.

## 9. Operations / deploy

- **CSP (Caddy):** MapLibre runs a **Web Worker** (`blob:`) and fetches style JSON, vector tiles, glyphs and sprites from OpenFreeMap. The Caddyfile CSP (if set) must allow `worker-src blob:`, `connect-src https://tiles.openfreemap.org`, and `img-src`/`font-src` as needed. Adjust the deploy Caddyfile and document it.
- Bundle size: MapLibre is large (~200 kB gzip). It is only needed in Map mode and on the detail page — **lazy-load** the map wrapper (dynamic `import()`) so the list/other pages don't pay for it. This also keeps the main chunk from growing.

## 10. Internationalisation

Every new label (filters, spec-grid field names, building-type / renovation value labels, map controls, "approximate area", "Search this area", the View toggle) added to **both** `web/src/shared/i18n/uz.json` and `ru.json` with identical key sets; `pnpm i18n:check` enforces parity.

## 11. Testing

- **Backend (pytest):** parser reparse against a fixture payload that includes `ad.map` + the extra `ad.params` (assert coords, label, building_type, furnished, renovation, year, bathrooms); the new query filters (area/floor/not-first/not-top/building_type/furnished/renovation/posted_within/has_photos/bbox); the `/properties/pins` endpoint (filters honored, no-coord rows omitted, cap applied, admin/agent access).
- **Web (vitest):** extended filter model (new params serialize/deserialize via URL, bbox, `view` toggle, reset-advanced); the `shared/ui/map` wrapper with `maplibre-gl` mocked; the pins slice; detail-page additions render conditionally on null fields; hover-sync store behavior.
- Gates: `pnpm check` (typecheck / steiger / vitest / i18n / api / build) and the full backend suite green.

## 12. Acceptance criteria — done when

1. After migrate + reparse, real OLX properties have coords, `location_label`, and the parsed attributes populated (spot-checked in the DB and API).
2. The apartment page shows description, location label, mini-map, spec grid, posted date, and per-listing detail — each field hidden gracefully when absent.
3. `/properties` has the restructured filters (primary bar + More-filters popover) and all new filters work, survive reload/shared-link, and narrow both list and map.
4. The List ⇄ Map toggle works; Map mode shows the split layout with clustered approximate pins, hover/click sync, "Search this area" bbox, and click-through to the apartment.
5. Approximate precision is represented honestly (soft marker + radius + caption; no exact-address claim).
6. uz/ru parity holds; `pnpm check` + backend suite green; the map is lazy-loaded.

## 13. Parked (not in this milestone)

Exact-address geocoding; coords for Telegram/manual sources; per-attribute filters on the display-only `attributes` bag; physical duplicate merge; provider swap to Yandex/2GIS; dark theme.
