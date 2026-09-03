import { createEffect, createStore, sample } from "effector";
import { toast } from "sonner";
import { api, isApiProblem, unwrap, type Schemas } from "@/shared/api";
import { i18n, problemKey } from "@/shared/i18n";

export type Meta = Schemas["MetaOut"];

/** Enumerations the API owns (districts, statuses, source kinds); loaded once per session. */
export const loadMetaFx = createEffect(async (): Promise<Meta> => unwrap(api.GET("/api/v1/meta")));

export const $meta = createStore<Meta | null>(null).on(loadMetaFx.doneData, (_, m) => m);
export const $districts = $meta.map((m) => m?.districts ?? []);

/** A failed meta load has no dedicated UI — district chips just silently absent — so it must not fail silently. */
const toastErrorFx = createEffect((e: unknown) => { toast.error(i18n.t(isApiProblem(e) ? problemKey(e.code) : "errors.network")); });
sample({ clock: loadMetaFx.failData, target: toastErrorFx });
