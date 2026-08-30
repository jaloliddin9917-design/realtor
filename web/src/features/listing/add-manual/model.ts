import { createEffect, createEvent, createStore, sample } from "effector";
import { toast } from "sonner";
import { api, isApiProblem, unwrap, type Schemas } from "@/shared/api";
import { i18n, problemKey } from "@/shared/i18n";
import { routes } from "@/shared/router";

type ManualResult = Schemas["ManualResult"];
export const addUrlRequested = createEvent<string>();
export const dialogClosed = createEvent();
export const addUrlFx = createEffect((url: string): Promise<ManualResult> => unwrap(api.POST("/api/v1/listings/manual", { body: { url } })));
export const $urlError = createStore<string | null>(null).reset(addUrlRequested, dialogClosed)
  .on(addUrlFx.failData, (_, e) => (isApiProblem(e) ? problemKey(e.code) : "errors.network"));
const toastFx = createEffect(() => { toast.success(i18n.t("manual.added")); });
sample({ clock: addUrlRequested, target: addUrlFx });
sample({ clock: addUrlFx.doneData, fn: (r) => ({ params: { id: r.property_id }, query: {} }), target: routes.property.navigate });
sample({ clock: addUrlFx.done, target: toastFx });
