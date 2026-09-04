import { createEffect, createEvent, createStore, sample } from "effector";
import { toast } from "sonner";
import { fetchBot, type ChannelStat, type OutreachCounters, type OutreachRow } from "./api";
import { isApiProblem } from "@/shared/api";
import { i18n, problemKey } from "@/shared/i18n";

const EMPTY_COUNTERS: OutreachCounters = { today: 0, queued: 0, replied: 0, unclear: 0, errors: 0 };

/** Load the bot monitor — wired to run on `botMonitor.opened` in app/router.ts, and again on
 * the "Yangilash" button (refreshRequested). */
export const fetchBotFx = createEffect(fetchBot);
export const refreshRequested = createEvent();
sample({ clock: refreshRequested, target: fetchBotFx });

/** An unclear reply was manually resolved (features/bot/resolve-unclear) — carries the full
 * updated row so `$rows` can swap it in place, mirroring entities/queue's takeFx.doneData. */
export const outreachResolved = createEvent<OutreachRow>();

export const $channels = createStore<ChannelStat[]>([])
  .on(fetchBotFx.doneData, (_, d) => d.channels);

export const $counters = createStore<OutreachCounters>(EMPTY_COUNTERS)
  .on(fetchBotFx.doneData, (_, d) => d.counters);

export const $rows = createStore<OutreachRow[]>([])
  .on(fetchBotFx.doneData, (_, d) => d.rows)
  .on(outreachResolved, (rows, updated) => rows.map((r) => (r.id === updated.id ? updated : r)));

export const $botPending = fetchBotFx.pending;

const toastErrorFx = createEffect((e: unknown) => {
  toast.error(i18n.t(isApiProblem(e) ? problemKey(e.code) : "errors.network"));
});
sample({ clock: fetchBotFx.failData, target: toastErrorFx });
