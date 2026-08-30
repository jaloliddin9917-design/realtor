import { createEffect, createEvent, sample } from "effector";
import { toast } from "sonner";
import { setPropertyStatus, statusUpdated } from "@/entities/property";
import { isApiProblem } from "@/shared/api";
import { i18n, problemKey } from "@/shared/i18n";

interface StatusRequest { id: string; status: "active" | "inactive"; note?: string }

export const statusRequested = createEvent<StatusRequest>();
export const setStatusFx = createEffect(({ id, status, note }: StatusRequest) => setPropertyStatus(id, status, note));

const toastFx = createEffect((key: string) => { toast.success(i18n.t(key)); });
const toastErrorFx = createEffect((e: unknown) => { toast.error(i18n.t(isApiProblem(e) ? problemKey(e.code) : "errors.network")); });

sample({ clock: statusRequested, target: setStatusFx });
// the API answers with the event it recorded, so the detail shows the real actor and time
sample({ clock: setStatusFx.done, fn: ({ params, result }) => ({ id: params.id, event: result }), target: statusUpdated });
sample({ clock: setStatusFx.done, fn: () => "property.statusChanged", target: toastFx });
sample({ clock: setStatusFx.failData, target: toastErrorFx });
