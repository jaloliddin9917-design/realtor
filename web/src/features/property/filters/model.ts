/**
 * Filter state lives in the URL, not in the components. Every filter is a plain string store
 * (that is what a query string can hold), `querySync` mirrors those stores into
 * `/properties?…` and back, and `$query` derives the typed request the API wants. So a
 * reload, a shared link and the back button all restore the same list, and no component
 * needs `useState` for anything another component also reads.
 */
import { querySync } from "atomic-router";
import { combine, createEffect, createEvent, createStore, sample } from "effector";
import { debounce } from "patronum";
import { toast } from "sonner";
import { $total, fetchPinsFx, fetchPropertiesFx, type PropertyQuery, type PropertyStatus, type SortKey } from "@/entities/property";
import { $isAuthorized } from "@/entities/session";
import { isApiProblem } from "@/shared/api";
import { i18n, problemKey } from "@/shared/i18n";
import { controls, routes } from "@/shared/router";

const PAGE_SIZE = 20;
/** The UI offers "4+"; the API filters exact room counts, so it expands to a range. */
const ROOMS_PLUS = [4, 5, 6, 7, 8];
const SORTS: SortKey[] = ["last_seen", "first_seen", "price_asc", "price_desc"];
const STATUSES: PropertyStatus[] = ["new", "active", "inactive"];
const SOURCES = ["olx", "telegram", "manual"] as const;
type SourceKind = (typeof SOURCES)[number];
const POSTED_WITHIN = ["24h", "3d", "7d"] as const;

export const districtToggled = createEvent<string>();
export const roomsToggled = createEvent<"1" | "2" | "3" | "4">();
export const priceChanged = createEvent<{ min: string; max: string }>();
export const statusChanged = createEvent<string>();
export const sourceChanged = createEvent<string>();
export const ownerOnlyToggled = createEvent();
export const removedToggled = createEvent();
export const searchChanged = createEvent<string>();
export const sortChanged = createEvent<string>();
export const pageChanged = createEvent<number>();
export const filtersCleared = createEvent();

// These all started out behind the "More filters" dialog. The redesign promoted
// buildingTypeToggled/notFirstFloorToggled/notTopFloorToggled/hasPhotosToggled into the
// always-visible filter rail (see ui.tsx) — only areaChanged/floorChanged/furnishedChanged/
// renovationToggled/postedWithinChanged are still the dialog's own. `advancedReset` — the
// dialog's "reset advanced" button — resets only that narrower, still-in-the-dialog set (see
// the stores below), so it never touches district/q/rooms/etc., nor the filters the rail
// promoted out of the dialog.
export const areaChanged = createEvent<{ min: string; max: string }>();
export const floorChanged = createEvent<{ min: string; max: string }>();
export const notFirstFloorToggled = createEvent();
export const notTopFloorToggled = createEvent();
export const buildingTypeToggled = createEvent<string>();
export const furnishedChanged = createEvent<string>();
export const renovationToggled = createEvent<string>();
export const postedWithinChanged = createEvent<string>();
export const hasPhotosToggled = createEvent();
export const advancedReset = createEvent();

const toggle = (csv: string, key: string): string => {
  const set = new Set(csv ? csv.split(",") : []);
  if (!set.delete(key)) set.add(key);
  return [...set].join(",");
};

// Every store also resets when the list route closes — not only on `filtersCleared` — so
// leaving the list (e.g. to a property page) never leaves a filter that silently re-applies
// on return. `querySync`'s read direction alone cannot be relied on for this: it only fires
// when the router's query actually changes, and closing to `/properties/p1` and back to a
// bare `/properties` can leave that query shallow-equal to `{}` throughout the round trip
// (see the "clears the filter stores…" test for the exact repro).
export const $district = createStore("").on(districtToggled, toggle).reset([filtersCleared, routes.properties.closed]);
export const $rooms = createStore("").on(roomsToggled, toggle).reset([filtersCleared, routes.properties.closed]);
export const $priceMin = createStore("").on(priceChanged, (_, p) => p.min).reset([filtersCleared, routes.properties.closed]);
export const $priceMax = createStore("").on(priceChanged, (_, p) => p.max).reset([filtersCleared, routes.properties.closed]);
export const $status = createStore("").on(statusChanged, toggle).reset([filtersCleared, routes.properties.closed]);
export const $source = createStore("").on(sourceChanged, (_, s) => s).reset([filtersCleared, routes.properties.closed]);
export const $ownerOnly = createStore("").on(ownerOnlyToggled, (v) => (v ? "" : "1")).reset([filtersCleared, routes.properties.closed]);
export const $removed = createStore("").on(removedToggled, (v) => (v ? "" : "1")).reset([filtersCleared, routes.properties.closed]);
export const $q = createStore("").on(searchChanged, (_, q) => q).reset([filtersCleared, routes.properties.closed]);
export const $sort = createStore("").on(sortChanged, (_, s) => s).reset([filtersCleared, routes.properties.closed]);
export const $page = createStore("").on(pageChanged, (_, p) => (p > 1 ? String(p) : "")).reset([filtersCleared, routes.properties.closed]);

// The filters still shown in the "More filters" dialog reset on `advancedReset` too, on top
// of the same clear-list/leave-list resets every filter gets — `advancedReset` never touches
// the primary stores above, so clearing them from the dialog cannot surprise-clear the search
// bar.
export const $areaMin = createStore("").on(areaChanged, (_, p) => p.min).reset([filtersCleared, routes.properties.closed, advancedReset]);
export const $areaMax = createStore("").on(areaChanged, (_, p) => p.max).reset([filtersCleared, routes.properties.closed, advancedReset]);
export const $floorMin = createStore("").on(floorChanged, (_, p) => p.min).reset([filtersCleared, routes.properties.closed, advancedReset]);
export const $floorMax = createStore("").on(floorChanged, (_, p) => p.max).reset([filtersCleared, routes.properties.closed, advancedReset]);
export const $furnished = createStore("").on(furnishedChanged, (_, v) => v).reset([filtersCleared, routes.properties.closed, advancedReset]);
export const $renovation = createStore("").on(renovationToggled, toggle).reset([filtersCleared, routes.properties.closed, advancedReset]);
export const $postedWithin = createStore("").on(postedWithinChanged, (_, v) => v).reset([filtersCleared, routes.properties.closed, advancedReset]);

// buildingType/notFirstFloor/notTopFloor/hasPhotos used to live in the "More filters" dialog
// too, but the redesign promoted them into the always-visible filter rail (see ui.tsx) — they
// still reset on `filtersCleared`/leaving the list like every filter, but NOT on
// `advancedReset`, since the dialog no longer shows (or claims to control) them; resetting them
// from a dialog that does not display them would silently clear rail state out from under it.
export const $notFirstFloor = createStore("").on(notFirstFloorToggled, (v) => (v ? "" : "1")).reset([filtersCleared, routes.properties.closed]);
export const $notTopFloor = createStore("").on(notTopFloorToggled, (v) => (v ? "" : "1")).reset([filtersCleared, routes.properties.closed]);
export const $buildingType = createStore("").on(buildingTypeToggled, toggle).reset([filtersCleared, routes.properties.closed]);
export const $hasPhotos = createStore("").on(hasPhotosToggled, (v) => (v ? "" : "1")).reset([filtersCleared, routes.properties.closed]);

/**
 * Shown as a badge on the "More filters" button — how many of the dialog's OWN filters are
 * set (area, floor range, furnished, renovation, posted-within). Deliberately excludes
 * buildingType/notFirstFloor/notTopFloor/hasPhotos: those live in the rail now, the dialog
 * doesn't render them, and a badge counting filters the dialog can't show (or clear) would be
 * misleading.
 */
export const $advancedCount = combine(
  { areaMin: $areaMin, areaMax: $areaMax, floorMin: $floorMin, floorMax: $floorMax, furnished: $furnished, renovation: $renovation, postedWithin: $postedWithin },
  (f) => Object.values(f).filter((v) => v !== "").length,
);

/**
 * Map view: a List⇄Map toggle, hover sync between a card and its pin, and an optional
 * "search this area" bounding box. None of these reach the API on their own — `$view` and
 * `$hoveredId` are pure UI state — except the bbox, which `$query` folds in below, and only
 * once "search this area" is switched on.
 */

/** A map viewport in plain lat/lon corners — the same shape `MapView`'s `onBoundsChange`
 * reports; kept local so this feature does not import the map widget (and its maplibre-gl
 * dependency) just for a type. */
export interface Bounds { minLat: number; minLon: number; maxLat: number; maxLon: number }

export const viewChanged = createEvent<"list" | "map">();
export const hovered = createEvent<string | null>();
export const searchAreaToggled = createEvent();
export const boundsChanged = createEvent<Bounds>();

/** Set by whichever panel the pointer is over (a card in the list, wired in `pages/properties`)
 * and read by `PropertyMap` to glow the matching pin. Resets with the rest of the list's
 * transient state when the route closes. */
export const $hoveredId = createStore<string | null>(null).on(hovered, (_, id) => id).reset(routes.properties.closed);

/**
 * Stored as `""`/`"map"` rather than `"list"`/`"map"` so a plain visit never writes `view=list`
 * into the address bar — `querySync`'s `empty` cleanup below drops a key whose value is falsy,
 * exactly like every boolean filter above (`$ownerOnly`, `$removed`, …). `$view` is the public,
 * typed (`"list"|"map"`) view of this that the rest of the app reads; it can't carry the
 * reducer itself, because a `.map()`-derived store can't be a `querySync` `source` entry (that
 * needs a plain store it can `.on()` for the URL-to-store direction).
 */
const $viewParam = createStore("").on(viewChanged, (_, v) => (v === "map" ? "map" : "")).reset(routes.properties.closed);
export const $view = $viewParam.map((v): "list" | "map" => (v === "map" ? "map" : "list"));

// "Search this area" is off (and the bbox below ignored) by default, like every other filter —
// switching it on re-queries with whatever the map's current viewport happens to be.
export const $searchArea = createStore("").on(searchAreaToggled, (v) => (v ? "" : "1")).reset([filtersCleared, routes.properties.closed]);
// also cleared on `filtersCleared`, like every other filter store above — otherwise a stale
// viewport could silently reapply itself the next time "search this area" is switched back on.
export const $bounds = createStore<Bounds | null>(null).on(boundsChanged, (_, b) => b).reset([filtersCleared, routes.properties.closed]);

// any filter change returns to page 1 — page 7 of the old result set means nothing in the new
// one. `searchAreaToggled` belongs here too: flipping it always changes the effective query,
// the same as every other filter in this clock.
sample({
  clock: [districtToggled, roomsToggled, priceChanged, statusChanged, sourceChanged, ownerOnlyToggled, removedToggled, searchChanged, sortChanged, areaChanged, floorChanged, notFirstFloorToggled, notTopFloorToggled, buildingTypeToggled, furnishedChanged, renovationToggled, postedWithinChanged, hasPhotosToggled, advancedReset, searchAreaToggled],
  fn: () => 1,
  target: pageChanged,
});

// `boundsChanged` fires on every map `moveend`, including with "search this area" off — and
// while it's off the bbox never reaches `$query` (below), so panning must not reset the page.
// Only reset it when the new viewport actually changes what is being asked for.
sample({
  clock: boundsChanged,
  source: $searchArea,
  filter: (searchArea) => searchArea === "1",
  fn: () => 1,
  target: pageChanged,
});

/**
 * A room-count token from the URL: "4" is the UI's "4+" and expands to a range; anything
 * that is not a plain non-negative integer (a stray "abc", an empty token from "2,,3") is
 * dropped rather than reaching the API as `NaN`.
 */
const roomTokens = (r: string): number[] => {
  if (r === "4") return ROOMS_PLUS;
  const n = Number(r);
  return r !== "" && Number.isInteger(n) ? [n] : [];
};

/**
 * A non-negative integer for a price bound; anything else — negative, fractional, empty,
 * garbage — is "no bound" rather than a value the API would reject or misread. `Math.trunc`
 * rounds a fractional value down instead of dropping the filter outright.
 */
const uint = (s: string): number | undefined => {
  const n = Math.trunc(Number(s));
  return s !== "" && Number.isFinite(n) && n >= 0 ? n : undefined;
};

/**
 * A page number: below 1 or non-integer both fall back to the first page. (`num(s) ?? 1`
 * used to let "0" and "-1" straight through unchanged, since `??` only catches
 * `null`/`undefined`, and 0 is neither.)
 */
const pageNum = (s: string): number => {
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 ? n : 1;
};

/**
 * A floor bound: unlike a price or an area, a floor may legitimately be negative (a basement
 * level), so — unlike `uint` — only non-integers and blanks are dropped, not negative numbers.
 */
const int = (s: string): number | undefined => {
  const n = Math.trunc(Number(s));
  return s !== "" && Number.isFinite(n) ? n : undefined;
};

export const $query = combine(
  {
    district: $district, rooms: $rooms, priceMin: $priceMin, priceMax: $priceMax, status: $status, source: $source, ownerOnly: $ownerOnly, removed: $removed, q: $q, sort: $sort, page: $page,
    areaMin: $areaMin, areaMax: $areaMax, floorMin: $floorMin, floorMax: $floorMax, notFirstFloor: $notFirstFloor, notTopFloor: $notTopFloor, buildingType: $buildingType, furnished: $furnished, renovation: $renovation, postedWithin: $postedWithin, hasPhotos: $hasPhotos,
    searchArea: $searchArea, bounds: $bounds,
  },
  (f): PropertyQuery => ({
    district: f.district ? f.district.split(",") : [],
    rooms: (f.rooms ? f.rooms.split(",") : []).flatMap(roomTokens),
    price_min: uint(f.priceMin),
    price_max: uint(f.priceMax),
    status: (f.status ? f.status.split(",") : []).filter((s): s is PropertyStatus => (STATUSES as string[]).includes(s)),
    source: (SOURCES as readonly string[]).includes(f.source) ? (f.source as SourceKind) : undefined,
    owner_only: f.ownerOnly === "1",
    removed: f.removed === "1",
    // trimmed and capped at 200 chars — belt-and-braces with the input's own `maxLength`,
    // since a URL or a shared link can carry whatever the address bar allows
    q: f.q.trim().slice(0, 200) || undefined,
    area_min: uint(f.areaMin),
    area_max: uint(f.areaMax),
    floor_min: int(f.floorMin),
    floor_max: int(f.floorMax),
    not_first_floor: f.notFirstFloor === "1" ? true : undefined,
    not_top_floor: f.notTopFloor === "1" ? true : undefined,
    building_type: f.buildingType ? f.buildingType.split(",") : undefined,
    furnished: f.furnished === "1" ? true : f.furnished === "0" ? false : undefined,
    renovation: f.renovation ? f.renovation.split(",") : undefined,
    posted_within: (POSTED_WITHIN as readonly string[]).includes(f.postedWithin) ? (f.postedWithin as PropertyQuery["posted_within"]) : undefined,
    has_photos: f.hasPhotos === "1" ? true : undefined,
    // meaningful only once the user has both switched "search this area" on and the map has
    // reported a viewport — otherwise every field here must stay `undefined`, the same
    // "no filter" signal the rest of this object relies on
    min_lat: f.searchArea === "1" ? f.bounds?.minLat : undefined,
    min_lon: f.searchArea === "1" ? f.bounds?.minLon : undefined,
    max_lat: f.searchArea === "1" ? f.bounds?.maxLat : undefined,
    max_lon: f.searchArea === "1" ? f.bounds?.maxLon : undefined,
    sort: (SORTS as string[]).includes(f.sort) ? (f.sort as SortKey) : "last_seen",
    page: pageNum(f.page),
    page_size: PAGE_SIZE,
  }),
);

/**
 * "The filters stopped moving": 300 ms after the last change to any of them. Both the URL
 * and the request hang off this rather than off the raw store updates, because a controlled
 * search box updates its store on every keystroke — and atomic-router *pushes* the query it
 * is given, so writing on every update would leave one history entry per character typed and
 * a back button that takes nine presses to escape. Chips and switches settle the same way;
 * only the address bar lags, since the controls themselves read the stores directly.
 */
const filtersSettled = debounce({ source: $query, timeout: 300 });

querySync({
  source: {
    district: $district, rooms: $rooms, price_min: $priceMin, price_max: $priceMax, status: $status, source: $source, owner_only: $ownerOnly, removed: $removed, q: $q, sort: $sort, page: $page,
    area_min: $areaMin, area_max: $areaMax, floor_min: $floorMin, floor_max: $floorMax, not_first_floor: $notFirstFloor, not_top_floor: $notTopFloor, building_type: $buildingType, furnished: $furnished, renovation: $renovation, posted_within: $postedWithin, has_photos: $hasPhotos,
    view: $viewParam,
  },
  // `view` never appears in `$query`, so it never rides `filtersSettled` — a bare `viewChanged`
  // has to write it too, or toggling the view alone would never reach the URL.
  clock: [filtersSettled, viewChanged],
  controls,
  route: routes.properties,
  cleanup: { irrelevant: true, empty: true, preserve: [] },
});

/**
 * Fetch when the list opens and once the filters settle. `$lastQuery` drops the duplicate
 * that `opened` and the settle would otherwise both fire when the URL already carries
 * filters (the URL is read into the stores, which counts as a change); it is cleared when
 * the list closes, so coming back to the page always refetches. `isAuthorized` keeps an
 * anonymous visit to `/properties` from firing a doomed request before the auth guard (wired
 * on the *chained* route in `app/router.ts`) redirects to `/login` — the raw `routes.properties`
 * this feature reads opens on a URL match alone, regardless of the guard's outcome.
 */
const $lastQuery = createStore<string | null>(null)
  .on(fetchPropertiesFx, (_, q) => JSON.stringify(q))
  // marked on the *call*, not on `.done`, so a request slower than the debounce cannot be
  // asked for twice; cleared on failure so the same query may be tried again
  .reset([routes.properties.closed, fetchPropertiesFx.fail]);

sample({
  clock: [routes.properties.opened, filtersSettled],
  source: { query: $query, last: $lastQuery, opened: routes.properties.$isOpened, isAuthorized: $isAuthorized },
  filter: ({ query, last, opened, isAuthorized }) => isAuthorized && opened && JSON.stringify(query) !== last,
  fn: ({ query }) => query,
  target: fetchPropertiesFx,
});

/**
 * Pins share `$query` with the list — same filters, same bbox — but are fetched separately and
 * only in map view: the list view never needs marker coordinates, and fetching them on every
 * visit regardless would be a wasted request. `$lastPinsQuery` mirrors `$lastQuery`'s dedup
 * trick one for one. `$view` sits in the clock alongside the usual two triggers so switching
 * from list to map with no filter change also fetches — as a store, its own update already
 * carries the new value by the time this sample reads it, unlike the `viewChanged` *event*,
 * which would race `$view`'s own `.on(viewChanged, …)` update for who runs first on the same
 * tick.
 */
const $lastPinsQuery = createStore<string | null>(null)
  .on(fetchPinsFx, (_, q) => JSON.stringify(q))
  .reset([routes.properties.closed, fetchPinsFx.fail]);

sample({
  clock: [routes.properties.opened, filtersSettled, $view],
  source: { query: $query, last: $lastPinsQuery, opened: routes.properties.$isOpened, isAuthorized: $isAuthorized, view: $view },
  filter: ({ query, last, opened, isAuthorized, view }) => isAuthorized && opened && view === "map" && JSON.stringify(query) !== last,
  fn: ({ query }) => query,
  target: fetchPinsFx,
});

/**
 * A failed list request has no retry UI (out of scope for this task — the user changes a
 * filter to try again), but it must not fail silently.
 */
export const toastErrorFx = createEffect((e: unknown) => {
  toast.error(i18n.t(isApiProblem(e) ? problemKey(e.code) : "errors.network"));
});
sample({ clock: fetchPropertiesFx.failData, target: toastErrorFx });

export const $pageCount = combine($total, (t) => Math.max(1, Math.ceil(t / PAGE_SIZE)));
