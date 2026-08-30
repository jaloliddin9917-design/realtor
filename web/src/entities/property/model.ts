import { createEffect, createStore } from "effector";
import { fetchProperties, fetchProperty, type PropertyDetail, type PropertyPage, type PropertyQuery } from "./api";

export const fetchPropertiesFx = createEffect(fetchProperties);
export const fetchPropertyFx = createEffect(fetchProperty);

export const $page = createStore<PropertyPage | null>(null).on(fetchPropertiesFx.doneData, (_, p) => p);
export const $rows = $page.map((p) => p?.items ?? []);
export const $total = $page.map((p) => p?.total ?? 0);
export const $listPending = fetchPropertiesFx.pending;

export const $detail = createStore<PropertyDetail | null>(null).on(fetchPropertyFx.doneData, (_, d) => d);
export const $detailPending = fetchPropertyFx.pending;

export type { PropertyQuery };
