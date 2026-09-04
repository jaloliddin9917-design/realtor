import { createEffect, createStore, sample } from "effector";
import { toast } from "sonner";
import { fetchUsers, type SettingUser } from "./api";
import { isApiProblem } from "@/shared/api";
import { i18n, problemKey } from "@/shared/i18n";

/** Load the users list — wired to run on `settings.opened` in app/router.ts, and again after a
 * successful add-user (features/settings/add-user) so the new row appears. */
export const fetchUsersFx = createEffect(fetchUsers);

export const $users = createStore<SettingUser[]>([])
  .on(fetchUsersFx.doneData, (_, users) => users);

const toastErrorFx = createEffect((e: unknown) => {
  toast.error(i18n.t(isApiProblem(e) ? problemKey(e.code) : "errors.network"));
});
sample({ clock: fetchUsersFx.failData, target: toastErrorFx });
