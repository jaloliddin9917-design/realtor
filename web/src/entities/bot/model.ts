import { createEffect, createEvent, createStore, sample } from "effector";
import { fetchBotOverview, MOCK_BOT_OVERVIEW, type ChannelStat, type DoNotContactStat, type OutreachCounters, type OutreachResult, type OutreachRow, type QuietHoursStat } from "./api";

/**
 * Unlike the real entities (`entities/source`, `entities/property`), the stores here are
 * seeded directly from the mock so the screen renders without any fetch-on-route-open wiring
 * in `app/router.ts`. `fetchBotFx` exists for the "Yangilash" button — it re-reads the same
 * mock (a stand-in for a real refetch later) but deliberately does not overwrite the stores,
 * so resolving an unclear reply survives a refresh instead of reverting.
 */
export const fetchBotFx = createEffect(fetchBotOverview);
export const refreshRequested = createEvent();
sample({ clock: refreshRequested, target: fetchBotFx });

export const outreachResolved = createEvent<{ id: string; result: Extract<OutreachResult, "vacant" | "taken"> }>();

export const $channels = createStore<ChannelStat[]>(MOCK_BOT_OVERVIEW.channels);
export const $quietHours = createStore<QuietHoursStat>(MOCK_BOT_OVERVIEW.quiet_hours);
export const $doNotContact = createStore<DoNotContactStat>(MOCK_BOT_OVERVIEW.do_not_contact);
export const $counters = createStore<OutreachCounters>(MOCK_BOT_OVERVIEW.counters);
export const $rows = createStore<OutreachRow[]>(MOCK_BOT_OVERVIEW.rows)
  .on(outreachResolved, (rows, { id, result }) => rows.map((r) => (r.id === id ? { ...r, result } : r)));

export const $botPending = fetchBotFx.pending;
