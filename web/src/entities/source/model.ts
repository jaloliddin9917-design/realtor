import { createEffect, createEvent, createStore } from "effector";
import { fetchSources, type Fx, type Source } from "./api";

export const fetchSourcesFx = createEffect(fetchSources);
export const sourceUpserted = createEvent<Source>();

export const $sources = createStore<Source[]>([])
  .on(fetchSourcesFx.doneData, (_, out) => out.items)
  .on(sourceUpserted, (list, s) => (list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [s, ...list]));
export const $fx = createStore<Fx | null>(null).on(fetchSourcesFx.doneData, (_, out) => out.fx);
export const $sourcesPending = fetchSourcesFx.pending;
