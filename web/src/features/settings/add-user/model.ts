import { createEffect, createEvent, createStore, sample } from "effector";
import { toast } from "sonner";
import { addUser, fetchUsersFx, type AddUserInput } from "@/entities/setting";
import { isApiProblem } from "@/shared/api";
import { i18n, problemKey } from "@/shared/i18n";

export const addRequested = createEvent<AddUserInput>();
export const dialogClosed = createEvent();
export const addUserFx = createEffect(addUser);
export const $added = createStore(false).on(addUserFx.done, () => true).reset(addRequested, dialogClosed);
const toastFx = createEffect(() => { toast.success(i18n.t("settingsPage.users.added")); });
const toastErrorFx = createEffect((e: unknown) => { toast.error(i18n.t(isApiProblem(e) ? problemKey(e.code) : "errors.network")); });

sample({ clock: addRequested, target: addUserFx });
// The server is the source of truth for the list (ordering, any field it computes) — a refetch
// on success rather than appending addUserFx's own response locally.
sample({ clock: addUserFx.done, target: [fetchUsersFx, toastFx] });
sample({ clock: addUserFx.failData, target: toastErrorFx });
