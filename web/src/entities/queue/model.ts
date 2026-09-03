import { createEffect, createEvent, createStore, sample } from "effector";
import { toast } from "sonner";
import { fetchQueue, releaseItem, takeItem, type QueueItem } from "./api";
import { isApiProblem } from "@/shared/api";
import { i18n, problemKey } from "@/shared/i18n";

/** Load the open queue — wired to run on `queue.opened` in app/router.ts. */
export const fetchQueueFx = createEffect(() => fetchQueue("all"));
/** Claim an item (POST take); the effect rejects with a 409 `queue.locked` problem if another
 * agent already holds it. */
export const takeFx = createEffect(takeItem);
/** Release my claim (POST release); also invoked after a call is logged. */
export const releaseFx = createEffect(releaseItem);

/** "Olish va qo'ng'iroq" / "Qayta urinish" — claim the item (features/queue/take then navigates). */
export const take = createEvent<string>();
/** A call was logged for an item (features/call/log-result) — release its lock. */
export const released = createEvent<string>();

export const $items = createStore<QueueItem[]>([])
  .on(fetchQueueFx.doneData, (_, items) => items)
  .on(takeFx.doneData, (items, taken) => items.map((i) => (i.id === taken.id ? taken : i)));

sample({ clock: take, target: takeFx });
sample({ clock: released, target: releaseFx });
// re-sync from the server after a release, or after a take that lost the race (409)
sample({ clock: [releaseFx.done, takeFx.fail], target: fetchQueueFx });

const toastErrorFx = createEffect((e: unknown) => {
  toast.error(i18n.t(isApiProblem(e) ? problemKey(e.code) : "errors.network"));
});
sample({ clock: [fetchQueueFx.failData, takeFx.failData, releaseFx.failData], target: toastErrorFx });
