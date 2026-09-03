import { createEffect, createEvent, createStore } from "effector";
import { fetchSettingsOverview, MOCK_SETTINGS, type BotChannelSetting, type Rules, type SettingUser, type SourceFeed } from "./api";

/**
 * As with `entities/bot`, the stores are seeded directly from the mock so the screen renders
 * without any fetch-on-route-open wiring in `app/router.ts`. `fetchSettingsFx` is the seam a
 * real backend swap would use; nothing on the page calls it yet.
 */
export const fetchSettingsFx = createEffect(fetchSettingsOverview);

export const userAdded = createEvent<SettingUser>();
export const rulesSaved = createEvent<Rules>();

export const $users = createStore<SettingUser[]>(MOCK_SETTINGS.users).on(userAdded, (list, u) => [...list, u]);
export const $sources = createStore<SourceFeed[]>(MOCK_SETTINGS.sources);
export const $botChannels = createStore<BotChannelSetting[]>(MOCK_SETTINGS.bot_channels);
export const $rules = createStore<Rules>(MOCK_SETTINGS.rules).on(rulesSaved, (_, r) => r);
