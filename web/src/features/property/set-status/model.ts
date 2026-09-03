import { createEffect, createEvent, createStore, sample } from "effector";
import { toast } from "sonner";
import { setPropertyStatus, statusUpdated } from "@/entities/property";
import { isApiProblem } from "@/shared/api";
import { i18n, problemKey } from "@/shared/i18n";

interface StatusRequest { id: string; status: "active" | "inactive"; note?: string }

export const statusRequested = createEvent<StatusRequest>();
export const setStatusFx = createEffect(({ id, status, note }: StatusRequest) => setPropertyStatus(id, status, note));

export const noteChanged = createEvent<string>();
export const noteCleared = createEvent();
/**
 * The agent's draft note. Cleared only once the write it was sent with has actually succeeded
 * (see the `setStatusFx.done` sample below) — not the moment the button is clicked — so a
 * failed POST leaves what they typed in place for a retry instead of silently discarding it.
 */
export const $note = createStore("").on(noteChanged, (_, v) => v).reset(noteCleared);

const toastFx = createEffect((key: string) => { toast.success(i18n.t(key)); });
const toastErrorFx = createEffect((e: unknown) => { toast.error(i18n.t(isApiProblem(e) ? problemKey(e.code) : "errors.network")); });

sample({ clock: statusRequested, target: setStatusFx });
// the API answers with the event it recorded, so the detail shows the real actor and time
sample({ clock: setStatusFx.done, fn: ({ params, result }) => ({ id: params.id, event: result }), target: statusUpdated });
sample({ clock: setStatusFx.done, fn: () => "property.statusChanged", target: toastFx });
sample({ clock: setStatusFx.done, target: noteCleared });
sample({ clock: setStatusFx.failData, target: toastErrorFx });
