import { createEffect, createStore } from "effector";
import { api, unwrap, type Schemas } from "@/shared/api";

export type Meta = Schemas["MetaOut"];

/** Enumerations the API owns (districts, statuses, source kinds); loaded once per session. */
export const loadMetaFx = createEffect(async (): Promise<Meta> => unwrap(api.GET("/api/v1/meta")));

export const $meta = createStore<Meta | null>(null).on(loadMetaFx.doneData, (_, m) => m);
export const $districts = $meta.map((m) => m?.districts ?? []);
