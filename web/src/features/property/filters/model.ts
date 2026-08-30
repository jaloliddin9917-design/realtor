/**
 * Filter state lives in the URL, not in the components. Every filter is a plain string store
 * (that is what a query string can hold), `querySync` mirrors those stores into
 * `/properties?…` and back, and `$query` derives the typed request the API wants. So a
 * reload, a shared link and the back button all restore the same list, and no component
 * needs `useState` for anything another component also reads.
 */
import { querySync } from "atomic-router";
import { combine, createEvent, createStore, sample } from "effector";
import { debounce } from "patronum";
import { $total, fetchPropertiesFx, type PropertyQuery, type PropertyStatus, type SortKey } from "@/entities/property";
import { controls, routes } from "@/shared/router";

const PAGE_SIZE = 20;
/** The UI offers "4+"; the API filters exact room counts, so it expands to a range. */
const ROOMS_PLUS = [4, 5, 6, 7, 8];
const SORTS: SortKey[] = ["last_seen", "first_seen", "price_asc", "price_desc"];
const STATUSES: PropertyStatus[] = ["new", "active", "inactive"];
const SOURCES = ["olx", "telegram", "manual"] as const;
type SourceKind = (typeof SOURCES)[number];

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

const toggle = (csv: string, key: string): string => {
  const set = new Set(csv ? csv.split(",") : []);
  if (!set.delete(key)) set.add(key);
  return [...set].join(",");
};

export const $district = createStore("").on(districtToggled, toggle).reset(filtersCleared);
export const $rooms = createStore("").on(roomsToggled, toggle).reset(filtersCleared);
export const $priceMin = createStore("").on(priceChanged, (_, p) => p.min).reset(filtersCleared);
export const $priceMax = createStore("").on(priceChanged, (_, p) => p.max).reset(filtersCleared);
export const $status = createStore("").on(statusChanged, toggle).reset(filtersCleared);
export const $source = createStore("").on(sourceChanged, (_, s) => s).reset(filtersCleared);
export const $ownerOnly = createStore("").on(ownerOnlyToggled, (v) => (v ? "" : "1")).reset(filtersCleared);
export const $removed = createStore("").on(removedToggled, (v) => (v ? "" : "1")).reset(filtersCleared);
export const $q = createStore("").on(searchChanged, (_, q) => q).reset(filtersCleared);
export const $sort = createStore("").on(sortChanged, (_, s) => s).reset(filtersCleared);
export const $page = createStore("").on(pageChanged, (_, p) => (p > 1 ? String(p) : "")).reset(filtersCleared);

// any filter change returns to page 1 — page 7 of the old result set means nothing in the new one
sample({
  clock: [districtToggled, roomsToggled, priceChanged, statusChanged, sourceChanged, ownerOnlyToggled, removedToggled, searchChanged, sortChanged],
  fn: () => 1,
  target: pageChanged,
});

const num = (s: string): number | undefined => {
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : undefined;
};

export const $query = combine(
  { district: $district, rooms: $rooms, priceMin: $priceMin, priceMax: $priceMax, status: $status, source: $source, ownerOnly: $ownerOnly, removed: $removed, q: $q, sort: $sort, page: $page },
  (f): PropertyQuery => ({
    district: f.district ? f.district.split(",") : [],
    rooms: (f.rooms ? f.rooms.split(",") : []).flatMap((r) => (r === "4" ? ROOMS_PLUS : [Number(r)])),
    price_min: num(f.priceMin),
    price_max: num(f.priceMax),
    status: (f.status ? f.status.split(",") : []).filter((s): s is PropertyStatus => (STATUSES as string[]).includes(s)),
    source: (SOURCES as readonly string[]).includes(f.source) ? (f.source as SourceKind) : undefined,
    owner_only: f.ownerOnly === "1",
    removed: f.removed === "1",
    q: f.q || undefined,
    sort: (SORTS as string[]).includes(f.sort) ? (f.sort as SortKey) : "last_seen",
    page: num(f.page) ?? 1,
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
  source: { district: $district, rooms: $rooms, price_min: $priceMin, price_max: $priceMax, status: $status, source: $source, owner_only: $ownerOnly, removed: $removed, q: $q, sort: $sort, page: $page },
  clock: filtersSettled,
  controls,
  route: routes.properties,
  cleanup: { irrelevant: true, empty: true, preserve: [] },
});

/**
 * Fetch when the list opens and once the filters settle. `$lastQuery` drops the duplicate
 * that `opened` and the settle would otherwise both fire when the URL already carries
 * filters (the URL is read into the stores, which counts as a change); it is cleared when
 * the list closes, so coming back to the page always refetches.
 */
const $lastQuery = createStore<string | null>(null)
  .on(fetchPropertiesFx, (_, q) => JSON.stringify(q))
  // marked on the *call*, not on `.done`, so a request slower than the debounce cannot be
  // asked for twice; cleared on failure so the same query may be tried again
  .reset([routes.properties.closed, fetchPropertiesFx.fail]);

sample({
  clock: [routes.properties.opened, filtersSettled],
  source: { query: $query, last: $lastQuery, opened: routes.properties.$isOpened },
  filter: ({ query, last, opened }) => opened && JSON.stringify(query) !== last,
  fn: ({ query }) => query,
  target: fetchPropertiesFx,
});

export const $pageCount = combine($total, (t) => Math.max(1, Math.ceil(t / PAGE_SIZE)));
