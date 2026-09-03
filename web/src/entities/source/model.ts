import { createEffect, createEvent, createStore, sample } from "effector";
import { toast } from "sonner";
import { fetchSources, type Fx, type Source } from "./api";
import { isApiProblem } from "@/shared/api";
import { i18n, problemKey } from "@/shared/i18n";

export const fetchSourcesFx = createEffect(fetchSources);
export const sourceUpserted = createEvent<Source>();

export const $sources = createStore<Source[]>([])
  .on(fetchSourcesFx.doneData, (_, out) => out.items)
  .on(sourceUpserted, (list, s) => (list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [s, ...list]));
export const $fx = createStore<Fx | null>(null).on(fetchSourcesFx.doneData, (_, out) => out.fx);
export const $sourcesPending = fetchSourcesFx.pending;

/**
 * A failed sources fetch has no retry UI, and an empty `$sources` on failure reads to the
 * admin as "no sources configured" rather than "the request failed" — it must not fail silently.
 */
const toastErrorFx = createEffect((e: unknown) => { toast.error(i18n.t(isApiProblem(e) ? problemKey(e.code) : "errors.network")); });
sample({ clock: fetchSourcesFx.failData, target: toastErrorFx });
