import { combine, createEffect, createEvent, createStore } from "effector";
import { fetchDuplicatePairs, MOCK_PAIRS, type DuplicatePair } from "./api";

/** Seeded with the mock queue so the review screen renders immediately; wired to a real fetch later. */
export const fetchDuplicatePairsFx = createEffect(fetchDuplicatePairs);

/** Which pair is open in the compare panel — set by clicking a queue row, the pager, or a decision. */
export const pairSelected = createEvent<number>();
/** A merge/different decision was recorded for a pair (fired by `features/duplicate/decide`). */
export const pairDecided = createEvent<{ id: string; decision: "merge" | "different" }>();

export const $pairs = createStore<DuplicatePair[]>(MOCK_PAIRS)
  .on(fetchDuplicatePairsFx.doneData, (_, pairs) => pairs);

export const $index = createStore(0).on(pairSelected, (_, i) => i);

/** Ids already decided this session — used to mark them in the queue list. */
export const $decidedIds = createStore<ReadonlySet<string>>(new Set())
  .on(pairDecided, (ids, { id }) => new Set(ids).add(id));

export const $current = combine($pairs, $index, (pairs, i) => pairs[i] ?? null);
