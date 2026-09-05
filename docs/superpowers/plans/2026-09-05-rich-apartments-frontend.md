# Rich apartments — frontend Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the location + rich attributes (already on the API after Plan 1) in the UI: a richer apartment page (description, location + mini-map, spec grid), restructured filters (a primary bar + a "More filters" dialog with area/floor/building-type/furnished/renovation/posted-within/has-photos), and a **List ⇄ Map view toggle** on `/properties` that shows a split cards-left / MapLibre-map-right "investigation" search with clustered approximate pins, hover sync, and a "search this area" bbox.

**Architecture:** Backend is done and merged (`GET /properties` gained the filters, `GET /properties/pins` returns lightweight located rows, and rows/detail/listings carry the new fields — all in the generated `web/src/shared/api/schema.d.ts`). The map is a `?view=map` mode of the existing `/properties` route (no new route), so the URL-synced Effector filter model, data, and page shell are reused. A thin `shared/ui/map` wrapper isolates MapLibre GL (OpenFreeMap style, no API key) and is lazy-loaded so the main bundle doesn't grow. Approximate coords (~2 km) are shown honestly (soft marker + radius, "approximate area" caption).

**Tech Stack:** React 19 + TypeScript 5.9 + Vite 8 + Tailwind 4 + shadcn/ui + Effector 23 + atomic-router 0.12 + i18next (uz/ru) + openapi-fetch + **maplibre-gl** (new) + FSD (steiger).

## Global Constraints

- FSD layers enforced by steiger; run `pnpm check` from `web/` (typecheck / steiger / vitest / **i18n:check** / api:check / vite build) — all must pass. Use `pnpm --dir web <script>` or run from `web/`.
- **i18n parity is enforced:** every new key exists in BOTH `web/src/shared/i18n/uz.json` and `ru.json` with identical key sets (`node scripts/check-i18n.mjs`). Never leave one catalogue behind.
- Effector conventions: filter state lives in URL-synced stores (`querySync`), not `useState`; tests use `fork({ values, handlers })` + `allSettled`. shadcn/ui from `@/shared/ui/*`; muted text = `text-muted-foreground`; `cn()` from `@/shared/lib`.
- Coordinates are **approximate** — never render them as an exact address; always pair a pin with its radius/`location_precise=false` treatment and an "approximate area" caption.
- **No CSP is set** (verified: neither `web/index.html` nor `deploy/Caddyfile` define one), so MapLibre's blob Web Worker and OpenFreeMap fetches work as-is. If a CSP is ever added, it must allow `worker-src blob:` and `connect-src`/`img-src https://*.openfreemap.org` — leave a comment noting this at the style-URL constant.
- Map provider: **MapLibre GL JS** with the **OpenFreeMap** style `https://tiles.openfreemap.org/styles/bright` (no key). Keep the style URL in one constant so the provider can be swapped.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FaiSj2uQts7dvqkGSrWTm7
  ```

## Execution note — parallelization

After **Task 1** (shared plumbing: i18n + entity pins slice + api) and **Task 2** (the map wrapper) land, **Task 3** (detail page) and **Tasks 4→5** (filters → map view) touch disjoint files and can run in **parallel git worktrees** (superpowers:using-git-worktrees), then merge. Task 3 files: `widgets/property-header/*`, `widgets/listings-list/*`, `pages/property/ui.tsx`. Tasks 4–5 files: `features/property/filters/*`, `pages/properties/ui.tsx`, `widgets/property-map/*`, `entities/property` (view/pins wiring). Both only *read* `shared/ui/map` and the Task-1 i18n keys. Task 6 (steiger + gates) runs last, after both lanes merge.

---

## File Structure

- **Modify** `web/src/shared/i18n/uz.json` + `ru.json` — all new keys (Task 1).
- **Modify** `web/src/shared/i18n/index.ts` — `buildingTypeKey`/`renovationKey`/`bathroomTypeKey` helpers (Task 1).
- **Modify** `web/src/entities/property/api.ts` — `Pin` type + `fetchPins` (Task 1).
- **Modify** `web/src/entities/property/model.ts` — `fetchPinsFx` + `$pins` (Task 1).
- **Create** `web/src/shared/ui/map/{index.ts,MapView.tsx,style.ts}` — MapLibre wrapper (Task 2).
- **Modify** `web/package.json` — add `maplibre-gl` (Task 2).
- **Modify** `web/src/widgets/property-header/ui/PropertyHeader.tsx` + **Create** `ui/SpecGrid.tsx`, `ui/LocationCard.tsx` — detail additions (Task 3).
- **Modify** `web/src/widgets/listings-list/ui/*` — per-listing detail (Task 3).
- **Modify** `web/src/features/property/filters/{model.ts,ui.tsx}` + **Create** `ui/MoreFilters.tsx` — filters (Task 4).
- **Create** `web/src/widgets/property-map/{index.ts,ui/PropertyMap.tsx}` — map widget (Task 5).
- **Modify** `web/src/pages/properties/ui.tsx` — view toggle + split layout (Task 5).
- **Modify** `web/src/features/property/filters/model.ts` — `$view`, `$hoveredId`, bbox, pins trigger (Task 5).
- **Modify** `web/steiger.config.ts` — overrides for the new slices (Task 6).

---

## Task 1: Shared plumbing — i18n keys, pins api + store

**Files:**
- Modify: `web/src/entities/property/api.ts`, `web/src/entities/property/model.ts`, `web/src/entities/property/index.ts`
- Modify: `web/src/shared/i18n/uz.json`, `web/src/shared/i18n/ru.json`, `web/src/shared/i18n/index.ts`
- Test: `web/src/entities/property/model.test.ts` (append)

**Interfaces:**
- Produces: `Pin = Schemas["PinOut"]`; `fetchPins(query: PropertyQuery): Promise<Pin[]>`; `fetchPinsFx`, `$pins: Store<Pin[]>`; i18n keys under `property.*`, `properties.filters.*`, `properties.map.*`, `buildingType.*`, `renovation.*`, `bathroomType.*`; helpers `buildingTypeKey(v)`, `renovationKey(v)`, `bathroomTypeKey(v)`.

- [ ] **Step 1: Write the failing test**

Append to `web/src/entities/property/model.test.ts`:
```ts
import { fork, allSettled } from "effector";
import { expect, test } from "vitest";
import { $pins, fetchPinsFx } from "./model";

test("$pins holds the fetched pins", async () => {
  const pins = [{ id: "p1", latitude: 41.3, longitude: 69.2, price_usd_min_minor: 40000, rooms: 2, status: "new", source_removed: false }];
  const scope = fork({ handlers: [[fetchPinsFx, async () => pins]] });
  await allSettled(fetchPinsFx, { scope, params: { district: [], rooms: [], status: [], owner_only: false, removed: false, sort: "last_seen", page: 1, page_size: 20 } });
  expect(scope.getState($pins)).toEqual(pins);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir web vitest run src/entities/property/model.test.ts`
Expected: FAIL — `$pins`/`fetchPinsFx` are not exported.

- [ ] **Step 3: Add the pins api**

In `web/src/entities/property/api.ts`, add after `PropertyDetail` type exports:
```ts
export type Pin = Schemas["PinOut"];
```
And after `fetchProperties`:
```ts
/** Lightweight located rows for the map — same filters as the list, minus sort/paging. */
export function fetchPins(query: PropertyQuery): Promise<Pin[]> {
  return unwrap(api.GET("/api/v1/properties/pins", {
    params: {
      query: {
        district: query.district.length ? query.district : undefined,
        rooms: query.rooms.length ? query.rooms : undefined,
        status: query.status.length ? query.status : undefined,
        price_min: query.price_min, price_max: query.price_max,
        source: query.source, owner_only: query.owner_only, removed: query.removed, q: query.q,
        area_min: query.area_min, area_max: query.area_max,
        floor_min: query.floor_min, floor_max: query.floor_max,
        not_first_floor: query.not_first_floor, not_top_floor: query.not_top_floor,
        building_type: query.building_type?.length ? query.building_type : undefined,
        furnished: query.furnished, renovation: query.renovation?.length ? query.renovation : undefined,
        posted_within: query.posted_within, has_photos: query.has_photos,
        min_lat: query.min_lat, min_lon: query.min_lon, max_lat: query.max_lat, max_lon: query.max_lon,
      },
    },
  }));
}
```
Extend the `PropertyQuery` interface in `api.ts` with the new optional fields (so both `fetchProperties` and `fetchPins` type-check):
```ts
  area_min?: number; area_max?: number;
  floor_min?: number; floor_max?: number;
  not_first_floor?: boolean; not_top_floor?: boolean;
  building_type?: string[];
  furnished?: boolean;
  renovation?: string[];
  posted_within?: "24h" | "3d" | "7d";
  has_photos?: boolean;
  min_lat?: number; min_lon?: number; max_lat?: number; max_lon?: number;
```
And spread the new list-only params in `fetchProperties`'s `query` object the same way (pass them through; empty arrays → undefined for `building_type`/`renovation`).

- [ ] **Step 4: Add the pins store**

In `web/src/entities/property/model.ts`, add:
```ts
import { fetchPins } from "./api";
export const fetchPinsFx = createEffect(fetchPins);
export const $pins = createStore<import("./api").Pin[]>([]).on(fetchPinsFx.doneData, (_, p) => p);
export const $pinsPending = fetchPinsFx.pending;
```
Export `fetchPinsFx`, `$pins`, `$pinsPending`, and `Pin` from `web/src/entities/property/index.ts`.

- [ ] **Step 5: Add i18n keys + label helpers**

Add to BOTH `uz.json` and `ru.json` (identical keys; translations per language) under the existing objects:
- `property.description`, `property.location`, `property.approximateArea`, `property.postedAt`, `property.specs`, `property.spec.buildingType`, `property.spec.furnished`, `property.spec.renovation`, `property.spec.yearBuilt`, `property.spec.bathroom`, `property.yes`, `property.no`.
- `properties.filters.more`, `properties.filters.moreCount` (`"Ещё {{count}}"` / `"Yana {{count}}"`), `properties.filters.area`, `properties.filters.areaMin`, `properties.filters.areaMax`, `properties.filters.floorMin`, `properties.filters.floorMax`, `properties.filters.notFirstFloor`, `properties.filters.notTopFloor`, `properties.filters.buildingType`, `properties.filters.furnished`, `properties.filters.renovation`, `properties.filters.postedWithin`, `properties.filters.hasPhotos`, `properties.filters.resetAdvanced`, `properties.filters.postedWithinOpts.24h`/`.3d`/`.7d`.
- `properties.map.list`, `properties.map.map`, `properties.map.searchArea`, `properties.map.pinsCount` (`"{{count}} на карте"`), `properties.map.noCoords`.
- New top-level objects `buildingType` (`brick`/`panel`/`monolith`/`block`/`other`), `renovation` (`euro`/`designer`/`cosmetic`/`average`/`needs_repair`/`other`), `bathroomType` (`combined`/`separate`/`multiple`).

In `web/src/shared/i18n/index.ts` add helpers mirroring the existing `districtKey`/`kindKey`:
```ts
export const buildingTypeKey = (v: string) => `buildingType.${v}`;
export const renovationKey = (v: string) => `renovation.${v}`;
export const bathroomTypeKey = (v: string) => `bathroomType.${v}`;
```

- [ ] **Step 6: Run tests + i18n check**

Run: `pnpm --dir web vitest run src/entities/property/model.test.ts && pnpm --dir web i18n:check`
Expected: PASS; i18n prints equal key counts in each catalogue.

- [ ] **Step 7: Commit**

```bash
git add web/src/entities/property web/src/shared/i18n
git commit -m "feat(web): pins api+store, filter query fields, and i18n keys for rich apartments"
```

---

## Task 2: `shared/ui/map` — MapLibre wrapper

**Files:**
- Create: `web/src/shared/ui/map/index.ts`, `web/src/shared/ui/map/style.ts`, `web/src/shared/ui/map/MapView.tsx`
- Modify: `web/package.json` (add `maplibre-gl`)
- Test: `web/src/shared/ui/map/MapView.test.tsx`

**Interfaces:**
- Produces: `<MapView>` — props `{ points?: {id,lat,lon,label?}[]; center?: [lon,lat]; zoom?: number; radiusMeters?: number|null; onPinClick?(id): void; onBoundsChange?(b: {minLat,minLon,maxLat,maxLon}): void; hoveredId?: string|null; className?: string }`. Two modes: a **single-marker** mode (one point + optional radius circle — for the detail mini-map) and a **cluster** mode (many points via a clustered GeoJSON source). `MAP_STYLE_URL` constant in `style.ts`.

- [ ] **Step 1: Add the dependency**

Run: `pnpm --dir web add maplibre-gl` (pins a version). Confirm `maplibre-gl` appears in `web/package.json` dependencies.

- [ ] **Step 2: Write the failing test (maplibre-gl mocked)**

`maplibre-gl` needs WebGL (absent in jsdom), so mock it. Create `web/src/shared/ui/map/MapView.test.tsx`:
```tsx
import { render } from "@testing-library/react";
import { expect, test, vi } from "vitest";

const addControl = vi.fn(); const on = vi.fn(); const remove = vi.fn(); const setData = vi.fn();
vi.mock("maplibre-gl", () => ({
  default: {
    Map: vi.fn(() => ({ addControl, on, remove, getSource: () => ({ setData }), addSource: vi.fn(), addLayer: vi.fn(), setCenter: vi.fn(), setZoom: vi.fn() })),
    NavigationControl: vi.fn(),
    Marker: vi.fn(() => ({ setLngLat: () => ({ addTo: vi.fn() }), remove: vi.fn() })),
  },
}));

test("MapView constructs a maplibre map", async () => {
  const { MapView } = await import("./MapView");
  const { container } = render(<MapView points={[{ id: "p1", lat: 41.3, lon: 69.2 }]} />);
  const maplibre = (await import("maplibre-gl")).default;
  expect(maplibre.Map).toHaveBeenCalled();
  expect(container.querySelector("div")).toBeTruthy();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --dir web vitest run src/shared/ui/map/MapView.test.tsx`
Expected: FAIL — `./MapView` does not exist.

- [ ] **Step 4: Implement the wrapper**

`web/src/shared/ui/map/style.ts`:
```ts
// OpenFreeMap — free vector tiles/style, no API key. If a CSP is ever added, allow
// worker-src blob: and connect-src/img-src https://*.openfreemap.org.
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";
export const TASHKENT_CENTER: [number, number] = [69.24, 41.31];
```
`web/src/shared/ui/map/MapView.tsx` — an imperative wrapper: create the `maplibregl.Map` in a `useEffect` on mount, add a clustered GeoJSON source + layers (or a single `Marker` + a circle layer when `points.length===1` and `radiusMeters`), push data to the source when `points` change, emit `onBoundsChange` on `moveend`, call `onPinClick` on cluster-leaf click, and dim/highlight the `hoveredId` feature via a feature-state. Import `import "maplibre-gl/dist/maplibre-gl.css";` at the top. Guard all map calls behind an `isStyleLoaded`/`load` event so early data pushes don't throw. Render a single `<div ref>` with `className` (default `h-full w-full min-h-64 rounded-card`). (Full component body: standard MapLibre GeoJSON-clustering setup — circle+count layers for clusters, a circle layer for unclustered points sized/colored by price bucket, and a `Marker` for the single-point mini-map. Keep it under ~160 lines; if it grows past that, report DONE_WITH_CONCERNS.)

`web/src/shared/ui/map/index.ts`: `export { MapView } from "./MapView"; export { MAP_STYLE_URL, TASHKENT_CENTER } from "./style";`

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --dir web vitest run src/shared/ui/map/MapView.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/shared/ui/map web/package.json web/pnpm-lock.yaml
git commit -m "feat(web): MapLibre map wrapper (OpenFreeMap, cluster + single-marker modes)"
```

---

## Task 3: Richer apartment page  *(Lane B — parallelizable after Task 2)*

**Files:**
- Create: `web/src/widgets/property-header/ui/SpecGrid.tsx`, `web/src/widgets/property-header/ui/LocationCard.tsx`
- Modify: `web/src/widgets/property-header/ui/PropertyHeader.tsx`, `web/src/widgets/property-header/index.ts`
- Modify: `web/src/widgets/listings-list/ui/*` (per-listing detail)
- Test: `web/src/widgets/property-header/ui/PropertyHeader.test.tsx` (create)

**Interfaces:**
- Consumes: `PropertyDetail` fields (`latitude`, `longitude`, `location_radius_m`, `location_label`, `building_type`, `is_furnished`, `renovation`, `year_built`), each listing's `attributes` (for `bathroom_type`), `MapView` from `shared/ui/map`, the Task-1 i18n keys/helpers.

- [ ] **Step 1: Write the failing test**

Create `PropertyHeader.test.tsx` rendering `<PropertyHeader detail={fixture}/>` (build a `PropertyDetail` fixture with coords + building_type="brick" + a description on its listing) inside `I18nextProvider`; assert the description text, the translated building-type label ("Кирпичный"/"G'ishtli"), the location label, and that a map container renders. Also assert a detail with all-null new fields renders WITHOUT the spec grid / location card (graceful).

- [ ] **Step 2: Run → FAIL** (`SpecGrid`/`LocationCard` don't exist).
Run: `pnpm --dir web vitest run src/widgets/property-header`

- [ ] **Step 3: Implement**
- `SpecGrid.tsx`: a small responsive grid of `label → value` cells for building type (via `buildingTypeKey`), furnished (`property.yes`/`no`), renovation (`renovationKey`), year built, bathroom (from the primary listing's `attributes.bathroom_type` via `bathroomTypeKey`), floor/total, area. Each cell rendered only when its value is non-null; the whole grid hidden when every cell is empty.
- `LocationCard.tsx`: shows `location_label` + a lazy-loaded `MapView` in single-marker mode centered on `[longitude, latitude]` with `radiusMeters={location_radius_m}` and an `property.approximateArea` caption; renders nothing when `latitude==null`. Lazy-load: `const MapView = lazy(() => import("@/shared/ui/map").then(m => ({ default: m.MapView })))` wrapped in `<Suspense fallback={<Skeleton/>}>`.
- `PropertyHeader.tsx`: below the price/title block, render `<SpecGrid detail={detail}/>`, a description card (the first listing's `description`, when non-empty), the posted date (`property.postedAt` from the newest listing's `posted_at`), and `<LocationCard detail={detail}/>`.
- `listings-list`: for each listing add original-currency + USD price, `posted_at`, an owner/agent badge (from `owner_marker`/`agent_marker`), and `location_label`.

- [ ] **Step 4: Run → PASS.** Run the same vitest path.

- [ ] **Step 5: Commit**
```bash
git add web/src/widgets/property-header web/src/widgets/listings-list
git commit -m "feat(web): richer apartment page — description, spec grid, location mini-map, per-listing detail"
```

---

## Task 4: Rich filters — model + "More filters" dialog  *(Lane C part 1 — after Task 1)*

**Files:**
- Modify: `web/src/features/property/filters/model.ts`, `web/src/features/property/filters/ui.tsx`
- Create: `web/src/features/property/filters/ui/MoreFilters.tsx`
- Test: `web/src/features/property/filters/model.test.ts` (append)

**Interfaces:**
- Produces: URL-synced stores + events for `areaMin/areaMax`, `floorMin/floorMax`, `notFirstFloor`, `notTopFloor`, `buildingType` (csv), `furnished` (tri-state ""/"1"/"0"), `renovation` (csv), `postedWithin`, `hasPhotos`; `$query` extended with the matching `PropertyQuery` fields (`area_min`, …, `building_type: string[]`, `furnished?: boolean`, `renovation: string[]`, `posted_within`, `has_photos`); `$advancedCount` (number of active advanced filters).

- [ ] **Step 1: Write the failing test** (append to `model.test.ts`)
Fork the scope, fire `areaChanged({min:"40",max:""})`, `buildingTypeToggled("brick")`, `postedWithinChanged("7d")`; assert `$query` maps to `{ area_min: 40, building_type: ["brick"], posted_within: "7d", … }` and `$advancedCount === 3`. A second test: fire each then `advancedReset()` and assert the advanced fields clear but the primary ones (district/q) remain.

- [ ] **Step 2: Run → FAIL.** Run: `pnpm --dir web vitest run src/features/property/filters/model.test.ts`

- [ ] **Step 3: Implement the model** — mirror the existing store pattern (each `createStore("").on(evt, …).reset([filtersCleared, routes.properties.closed])`), extend the `$query` combine with the parsed values (reuse `uint`; add an int parser for floor; `building_type`/`renovation` split like `status`; `furnished` `"1"→true/"0"→false/""→undefined`; `posted_within` validated against `["24h","3d","7d"]`; `has_photos` `"1"→true`), add all to `querySync`'s `source` map, and add each advanced event to the `pageChanged→1` reset `sample`. Add `advancedReset` (resets only the advanced stores) and `$advancedCount = combine(...)` counting non-empty advanced stores.

- [ ] **Step 4: Implement the UI** — `MoreFilters.tsx`: a `shared/ui/dialog` Dialog (there is no Popover component; Dialog is the established pattern) triggered by a "More filters" button showing `$advancedCount` as a badge; inside, controls for area (two inputs), floor (two inputs) + two switches (not-first/not-top), building-type chips (from a `["brick","panel","monolith","block"]` list via `buildingTypeKey`), furnished tri-state, renovation chips, posted-within select, has-photos switch, and a "reset advanced" button. Render `<MoreFilters/>` from `FilterBar` in `ui.tsx` (keep the primary bar as-is).

- [ ] **Step 5: Run → PASS** (model test). Run the same path.

- [ ] **Step 6: Commit**
```bash
git add web/src/features/property/filters
git commit -m "feat(web): rich filters — area/floor/building-type/furnished/renovation/posted-within/has-photos in a More-filters dialog"
```

---

## Task 5: Map view — List ⇄ Map toggle + split layout + pins  *(Lane C part 2 — after Tasks 2 & 4)*

**Files:**
- Modify: `web/src/features/property/filters/model.ts` (`$view`, `$hoveredId`, bbox stores, pins trigger)
- Create: `web/src/widgets/property-map/index.ts`, `web/src/widgets/property-map/ui/PropertyMap.tsx`
- Modify: `web/src/pages/properties/ui.tsx`
- Test: `web/src/features/property/filters/model.test.ts` (append); `web/src/widgets/property-map/ui/PropertyMap.test.tsx`

**Interfaces:**
- Consumes: `$pins`/`fetchPinsFx` (Task 1), `MapView` (Task 2), `$query` + filter stores (Task 4), `PropertyCardList` widget.
- Produces: `$view` (`"list"|"map"`, URL-synced as `view`), `viewChanged`; `$hoveredId` + `hovered` event; bbox stores fed by the map when "search this area" is on; `fetchPinsFx` fired when `view==="map"` on route-open and filter-settle.

- [ ] **Step 1: Write the failing test** (append to `model.test.ts`)
Assert `$view` defaults to `"list"`, `viewChanged("map")` sets it and it serializes to `view=map`; assert that when `$view==="map"`, a filter-settle triggers `fetchPinsFx` (fork with a `fetchPinsFx` handler + spy). Assert `hovered("p1")` sets `$hoveredId`.

- [ ] **Step 2: Run → FAIL.** Run: `pnpm --dir web vitest run src/features/property/filters/model.test.ts`

- [ ] **Step 3: Implement the model additions** — add `$view` (default `"list"`, `.on(viewChanged)`, reset on route close), include `view` in `querySync`; add `$hoveredId` + `hovered`; add optional bbox stores (`$searchArea` toggle + `$bounds`) that feed `min_lat…max_lat` into `$query` only when `$searchArea==="1"`. Extend the fetch `sample` so that when `$view==="map"`, `fetchPinsFx` is fired alongside `fetchPropertiesFx` (guarded by `$isAuthorized && opened`, deduped by a `$lastPinsQuery` mirror). Cards stay paginated via `fetchPropertiesFx`; pins come from `fetchPinsFx`.

- [ ] **Step 4: Implement `PropertyMap` widget** — composes the lazy-loaded `MapView` (cluster mode) with `$pins` mapped to `{id,lat,lon,label:price}`, wires `hovered`/`$hoveredId` for the card↔pin glow, `onPinClick` → navigate to the property (or scroll its card into view), and a "Search this area" switch bound to `$searchArea` with `onBoundsChange` feeding `$bounds`. Test with `maplibre-gl` mocked (as Task 2).

- [ ] **Step 5: Implement the page** — in `pages/properties/ui.tsx`, add a List/Map toggle (two buttons bound to `$view`/`viewChanged`) in the `ResultsBar` row. When `$view==="list"`, render the current table/cards. When `$view==="map"`, render a split: `<div class="grid lg:grid-cols-2 gap-3"><div class="overflow-y-auto max-h-[70vh]"><PropertyCardList rows={rows}/></div><div class="min-h-[70vh]"><PropertyMap/></div></div>` (on `<lg`, stack: show the map full-width above the cards, or a sub-toggle). Keep `<FilterBar/>`, `<ResultsBar/>`, `<Pagination/>`.

- [ ] **Step 6: Run → PASS** (model + widget tests). Run: `pnpm --dir web vitest run src/features/property src/widgets/property-map`

- [ ] **Step 7: Commit**
```bash
git add web/src/features/property/filters web/src/widgets/property-map web/src/pages/properties
git commit -m "feat(web): List/Map view toggle — split cards+MapLibre pins with hover sync and search-this-area"
```

---

## Task 6: FSD overrides, lazy-load check, full gates

**Files:**
- Modify: `web/steiger.config.ts`
- Test: `pnpm check` (whole web gate)

- [ ] **Step 1: Add steiger overrides** for the new single-consumer slices, mirroring the existing `warn` overrides in `steiger.config.ts`: add `"src/widgets/property-map/**"` to the property-page widget group (or a new `insignificant-slice: warn` block), and `"src/shared/ui/map/**"` needs none (shared/ui is a leaf). Confirm `features/property/**` (already `warn`) covers the extended filters.
- [ ] **Step 2: Confirm the map is lazy-loaded** — grep that `shared/ui/map` is only imported via `lazy(() => import(...))` in `LocationCard` and `PropertyMap`, not statically, so the main chunk doesn't pull MapLibre. (If a static import slipped in, convert it.)
- [ ] **Step 3: Run the full gate** — Run: `pnpm --dir web check`
  Expected: typecheck clean; steiger only the known `warn`s; **vitest all green**; **i18n:check equal counts**; api:check current; vite build succeeds (note the MapLibre chunk is a separate lazy chunk, not in the main bundle).
- [ ] **Step 4: Commit**
```bash
git add web/steiger.config.ts
git commit -m "chore(web): steiger overrides for property-map; verify lazy-loaded map + full gates"
```

---

## Self-Review

**Spec coverage:** spec §5 richer detail → Task 3; §6 rich filters → Task 4; §7 map view → Tasks 2+5; §8 deps/architecture (MapLibre wrapper, lazy-load) → Tasks 2+6; §10 i18n → Task 1 (+ enforced by every task's gate); §11 web tests → each task's vitest + Task 6 full gate. Backend §2–4 were Plan 1.

**Placeholder scan:** the MapLibre `MapView` body and a couple of component JSX blocks are described by behavior + constraints rather than pasted line-for-line — deliberate, because they are standard MapLibre/shadcn compositions whose exact markup is better written against the real components, and each names its inputs, outputs, size budget, and test. Every Effector model change, api function, i18n key list, and test is concrete.

**Type consistency:** `Pin`/`fetchPins`/`fetchPinsFx`/`$pins` (Task 1) ⇄ `PropertyMap` (Task 5). `PropertyQuery` new optional fields (Task 1) ⇄ filter `$query` mapping (Tasks 4–5) ⇄ `fetchPins`/`fetchProperties` params. i18n helpers `buildingTypeKey`/`renovationKey`/`bathroomTypeKey` (Task 1) ⇄ SpecGrid/MoreFilters (Tasks 3–4). `MapView` props (Task 2) ⇄ `LocationCard` single-marker use (Task 3) and `PropertyMap` cluster use (Task 5).
