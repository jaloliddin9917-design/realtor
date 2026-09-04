import { createEffect, createEvent, sample } from "effector";
import { toast } from "sonner";
import { $current, decideDuplicate, fetchDuplicatesFx, pairDecided, type Decision } from "@/entities/duplicate";
import { isApiProblem } from "@/shared/api";
import { i18n, problemKey } from "@/shared/i18n";

/** Merge / different, requested for whichever pair is currently open in the compare panel. */
export const decisionRequested = createEvent<Decision>();

export const decideFx = createEffect(({ id, decision }: { id: string; decision: Decision }) => decideDuplicate(id, decision));

sample({
  clock: decisionRequested,
  source: $current,
  // `$current` is only null before the queue has loaded, which the compare panel itself guards
  // against rendering — the filter here just tells TS what that already proved.
  filter: (current) => current !== null,
  fn: (current, decision) => ({ id: current!.id, decision }),
  target: decideFx,
});

// the decided pair drops out of entities/duplicate's `$pairs`, which also settles the pager on
// whatever now occupies its old slot — see that module's `queueTrimmed` for why this is one step
sample({ clock: decideFx.done, fn: ({ result }) => result.id, target: pairDecided });

const toastFx = createEffect((key: string) => { toast.success(i18n.t(key)); });
sample({
  clock: decideFx.done,
  fn: ({ params }) => (params.decision === "merge" ? "duplicates.decision.mergedToast" : "duplicates.decision.differentToast"),
  target: toastFx,
});

const toastErrorFx = createEffect((e: unknown) => {
  toast.error(i18n.t(isApiProblem(e) ? problemKey(e.code) : "errors.network"));
});
sample({ clock: decideFx.failData, target: toastErrorFx });

// someone else (another agent, another tab) already decided this pair — the local queue is
// stale, so resync it; the now-missing pair falls out of `$pairs` on the refetch.
sample({
  clock: decideFx.failData,
  filter: (e) => isApiProblem(e) && e.code === "dedupe.already_decided",
  target: fetchDuplicatesFx,
});
