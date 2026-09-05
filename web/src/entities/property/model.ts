import { createEffect, createEvent, createStore, sample } from "effector";
import { toast } from "sonner";
import { fetchPins, fetchProperties, fetchProperty, type Pin, type PropertyDetail, type PropertyPage, type PropertyQuery, type PropertyStatus, type StatusEvent } from "./api";
import { isApiProblem } from "@/shared/api";
import { i18n, problemKey } from "@/shared/i18n";
import { routes } from "@/shared/router";

export const fetchPropertiesFx = createEffect(fetchProperties);
export const fetchPropertyFx = createEffect(fetchProperty);
export const fetchPinsFx = createEffect(fetchPins);

export const $page = createStore<PropertyPage | null>(null).on(fetchPropertiesFx.doneData, (_, p) => p);
export const $rows = $page.map((p) => p?.items ?? []);
export const $total = $page.map((p) => p?.total ?? 0);
export const $listPending = fetchPropertiesFx.pending;

/** Lightweight rows for the map view — same query as the list, minus sort/paging. */
export const $pins = createStore<Pin[]>([]).on(fetchPinsFx.doneData, (_, p) => p);
export const $pinsPending = fetchPinsFx.pending;

/** A status change accepted by the API, so the open detail can show it without a refetch. */
export const statusUpdated = createEvent<{ id: string; event: StatusEvent }>();
/** The detail route closed — drop the property so the next one never flashes the previous. */
export const detailCleared = createEvent();

/**
 * The schema types `StatusEventOut.to_status` as a bare `string` (FastAPI does not carry the
 * enum into that field), while the store's `status` is the three-value union. Narrow rather
 * than cast: an unrecognised value leaves the status alone instead of corrupting the union.
 */
function asStatus(value: string, fallback: PropertyStatus): PropertyStatus {
  return value === "new" || value === "active" || value === "inactive" ? value : fallback;
}

/**
 * `fetchPropertyFx` can have two calls in flight at once — the user opens p1, then navigates
 * straight to p2 before p1 answers — and nothing guarantees the request that was *sent* first
 * *answers* first. Gating on the route's own `$params` (rather than accepting whatever
 * `doneData` shows up) means a late answer for a property that is no longer the open route is
 * dropped instead of overwriting `$detail` with the wrong property under the current URL.
 */
const detailForOpenRoute = sample({
  clock: fetchPropertyFx.doneData,
  source: routes.property.$params,
  filter: (params, detail) => params.id === detail.id,
  fn: (_params, detail) => detail,
});

export const $detail = createStore<PropertyDetail | null>(null)
  .on(detailForOpenRoute, (_, d) => d)
  .on(statusUpdated, (d, { id, event }) =>
    d && d.id === id
      ? {
          ...d,
          status: asStatus(event.to_status, d.status),
          last_status_event: event,
          // filter first: replaying the same event (a retry, a double click) must not duplicate it
          status_events: [event, ...d.status_events.filter((e) => e.id !== event.id)],
        }
      : d)
  .reset(detailCleared);
export const $detailPending = fetchPropertyFx.pending;

const toastErrorFx = createEffect((e: unknown) => { toast.error(i18n.t(isApiProblem(e) ? problemKey(e.code) : "errors.network")); });
/**
 * A 404 already renders as `property.notFound` (pages/property, driven by `$detail` staying
 * null) — that failure needs no toast on top. Anything else — network error, 500 — has no
 * dedicated UI, so it must not fail silently.
 */
sample({
  clock: fetchPropertyFx.failData,
  filter: (e) => !(isApiProblem(e) && e.status === 404),
  target: toastErrorFx,
});

export type { PropertyQuery };
