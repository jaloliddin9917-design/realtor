import { createEffect, createEvent, createStore } from "effector";
import { fetchQueue, MOCK_QUEUE, type QueueItem } from "./api";

/** Reserved for the real backend: not yet called anywhere (nothing wires it to a route-open
 * sample — see app/router.ts's own comment on why that wiring lives at the app layer). Kept so
 * swapping the mock for `/api/v1/queue` is a one-line change: seed `$items` from its `.doneData`
 * instead of `MOCK_QUEUE` below. */
export const fetchQueueFx = createEffect(fetchQueue);

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

/** An item became mine — locked to me until four hours from now. Fired by
 * features/queue/take on both the "new" and "retry" take actions. */
export const take = createEvent<string>();
/** A call was logged for an item (features/call/log-result) — its lock is released back to
 * the open pool so the next check (or another agent) can pick it up. */
export const released = createEvent<string>();

// Seeded directly from the mock array (not via fetchQueueFx) so the list renders immediately —
// see the "mock-data pattern" this whole slice follows.
export const $items = createStore<QueueItem[]>(MOCK_QUEUE)
  .on(take, (items, id) => items.map((item) =>
    item.id === id ? { ...item, state: { kind: "mine", until: new Date(Date.now() + FOUR_HOURS_MS).toISOString() } } : item))
  .on(released, (items, id) => items.map((item) => (item.id === id ? { ...item, state: { kind: "new" } } : item)));
