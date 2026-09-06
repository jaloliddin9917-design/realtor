import { combine, createEffect, createEvent, createStore, sample } from "effector";
import { toast } from "sonner";
import { fetchDuplicates, type DecidedRecent, type DuplicatePair, type DuplicateThresholds } from "./api";
import { isApiProblem } from "@/shared/api";
import { i18n, problemKey } from "@/shared/i18n";

const EMPTY_THRESHOLDS: DuplicateThresholds = { auto: 0, low: 0, high: 0 };
const EMPTY_DECIDED_RECENT: DecidedRecent = { days: 0, count: 0, mergedPct: 0 };

/** Load the review queue — wired to run on `duplicates.opened` in app/router.ts, and again after
 * a 409 `dedupe.already_decided` (see features/duplicate/decide) to resync with whoever else
 * just decided the pair. */
export const fetchDuplicatesFx = createEffect(fetchDuplicates);
export const $duplicatesPending = fetchDuplicatesFx.pending;

/** Which pair is open in the compare panel — set by clicking a queue row or the pager. */
export const pairSelected = createEvent<number>();
/** A merge/different decision was recorded for this pair id (fired by features/duplicate/decide
 * once its POST succeeds) — drops it from the queue, since a decided pair no longer appears in
 * `GET /duplicates` either. */
export const pairDecided = createEvent<string>();

export const $pairs = createStore<DuplicatePair[]>([])
  .on(fetchDuplicatesFx.doneData, (_, q) => q.pairs);

export const $thresholds = createStore<DuplicateThresholds>(EMPTY_THRESHOLDS)
  .on(fetchDuplicatesFx.doneData, (_, q) => q.thresholds);

export const $decidedRecent = createStore<DecidedRecent>(EMPTY_DECIDED_RECENT)
  .on(fetchDuplicatesFx.doneData, (_, q) => q.decidedRecent);

export const $index = createStore(0)
  .on(pairSelected, (_, i) => i)
  .on(fetchDuplicatesFx.doneData, () => 0);

export const $current = combine($pairs, $index, (pairs, i) => pairs[i] ?? null);

/**
 * Removing the decided pair and settling on "the next one" happen together, off the state as it
 * stood right before the decision — not as two independent `.on` reducers racing on `$pairs`
 * vs. `$index` — so the pager can't land mid-splice on a stale index. Leaving `$index` numerically
 * unchanged already surfaces "the next pair" once its slot shifts down by one; the only real work
 * here is clamping it when the decided pair was the last one in the queue.
 */
const queueTrimmed = createEvent<{ pairs: DuplicatePair[]; index: number }>();
sample({
  clock: pairDecided,
  source: { pairs: $pairs, index: $index },
  fn: ({ pairs, index }, id) => {
    const next = pairs.filter((p) => p.id !== id);
    return { pairs: next, index: Math.min(index, Math.max(next.length - 1, 0)) };
  },
  target: queueTrimmed,
});
$pairs.on(queueTrimmed, (_, { pairs }) => pairs);
$index.on(queueTrimmed, (_, { index }) => index);

const toastErrorFx = createEffect((e: unknown) => {
  toast.error(i18n.t(isApiProblem(e) ? problemKey(e.code) : "errors.network"));
});
sample({ clock: fetchDuplicatesFx.failData, target: toastErrorFx });
