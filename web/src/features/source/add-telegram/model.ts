import { createEffect, createEvent, createStore, sample } from "effector";
import { toast } from "sonner";
import { createSource, sourceUpserted, type SourceCreate } from "@/entities/source";
import { isApiProblem } from "@/shared/api";
import { i18n, problemKey } from "@/shared/i18n";

export const addRequested = createEvent<Omit<SourceCreate, "kind">>();
export const dialogClosed = createEvent();
export const addFx = createEffect((body: Omit<SourceCreate, "kind">) => createSource({ kind: "telegram", ...body }));
export const $peerError = createStore<string | null>(null).reset(addRequested, dialogClosed)
  .on(addFx.failData, (_, e) => (isApiProblem(e) && e.code === "source.peer_unresolved" ? problemKey(e.code) : null));
export const $addError = createStore<string | null>(null).reset(addRequested, dialogClosed)
  .on(addFx.failData, (_, e) => (isApiProblem(e) ? (e.code === "source.peer_unresolved" ? null : problemKey(e.code)) : "errors.network"));
export const $added = createStore(false).on(addFx.done, () => true).reset(addRequested, dialogClosed);
const toastFx = createEffect(() => { toast.success(i18n.t("sources.added")); });
sample({ clock: addRequested, target: addFx });
sample({ clock: addFx.doneData, target: [sourceUpserted, toastFx] });
