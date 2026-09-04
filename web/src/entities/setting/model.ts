import { createEffect, createEvent, createStore, sample } from "effector";
import { toast } from "sonner";
import { fetchUsers, MOCK_SETTINGS, type BotChannelSetting, type Rules, type SettingUser } from "./api";
import { isApiProblem } from "@/shared/api";
import { i18n, problemKey } from "@/shared/i18n";

/** Load the users list — wired to run on `settings.opened` in app/router.ts. */
export const fetchUsersFx = createEffect(fetchUsers);

export const userAdded = createEvent<SettingUser>();
export const rulesSaved = createEvent<Rules>();

export const $users = createStore<SettingUser[]>([])
  .on(fetchUsersFx.doneData, (_, users) => users)
  .on(userAdded, (list, u) => [...list, u]);

/** Bot channels and rules have no backend yet (see entities/setting/api.ts) — these two stay
 * seeded straight from the mock, never fetched. */
export const $botChannels = createStore<BotChannelSetting[]>(MOCK_SETTINGS.bot_channels);
export const $rules = createStore<Rules>(MOCK_SETTINGS.rules).on(rulesSaved, (_, r) => r);

const toastErrorFx = createEffect((e: unknown) => {
  toast.error(i18n.t(isApiProblem(e) ? problemKey(e.code) : "errors.network"));
});
sample({ clock: fetchUsersFx.failData, target: toastErrorFx });
