import { createEffect, createEvent, sample } from "effector";
import { toast } from "sonner";
import { $current, $index, $pairs, decidePair, pairDecided, pairSelected, type Decision } from "@/entities/duplicate";
import { i18n } from "@/shared/i18n";

/** Merge / different, requested for whichever pair is currently open in the compare panel. */
export const decisionRequested = createEvent<Decision>();

export const decideFx = createEffect(({ id, decision }: { id: string; decision: Decision }) => decidePair(id, decision));

sample({
  clock: decisionRequested,
  source: $current,
  // `$current` is only null before the queue has loaded, which never happens for a mock store
  // seeded up front — the filter guards it anyway, the `!` just tells TS what the filter proved.
  filter: (current) => current !== null,
  fn: (current, decision) => ({ id: current!.id, decision }),
  target: decideFx,
});

sample({ clock: decideFx.doneData, target: pairDecided });

// a decision closes the pair, so the reviewer lands on the next one in the queue
sample({
  clock: decideFx.doneData,
  source: { index: $index, total: $pairs.map((p) => p.length) },
  fn: ({ index, total }) => Math.min(index + 1, total - 1),
  target: pairSelected,
});

const toastFx = createEffect((key: string) => { toast.success(i18n.t(key)); });
sample({
  clock: decideFx.doneData,
  fn: ({ decision }) => (decision === "merge" ? "duplicates.decision.mergedToast" : "duplicates.decision.differentToast"),
  target: toastFx,
});
