import { createEffect, createEvent, createStore } from "effector";
import { fetchProperties, fetchProperty, type PropertyDetail, type PropertyPage, type PropertyQuery, type PropertyStatus, type StatusEvent } from "./api";

export const fetchPropertiesFx = createEffect(fetchProperties);
export const fetchPropertyFx = createEffect(fetchProperty);

export const $page = createStore<PropertyPage | null>(null).on(fetchPropertiesFx.doneData, (_, p) => p);
export const $rows = $page.map((p) => p?.items ?? []);
export const $total = $page.map((p) => p?.total ?? 0);
export const $listPending = fetchPropertiesFx.pending;

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

export const $detail = createStore<PropertyDetail | null>(null)
  .on(fetchPropertyFx.doneData, (_, d) => d)
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

export type { PropertyQuery };
