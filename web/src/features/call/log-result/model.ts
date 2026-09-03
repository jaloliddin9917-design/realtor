import { createEffect, createEvent, createStore, sample } from "effector";
import { toast } from "sonner";
import { logCall, type CallLogInput, type CallOutcome, type NextCheckChoice, type ResultingStatus } from "@/entities/call";
import { released } from "@/entities/queue";
import { i18n } from "@/shared/i18n";
import { routes } from "@/shared/router";

export const outcomeChanged = createEvent<CallOutcome>();
export const foreignersToggled = createEvent<boolean>();
export const familyOnlyToggled = createEvent<boolean>();
export const depositChanged = createEvent<string>();
export const noteChanged = createEvent<string>();
export const nextCheckChanged = createEvent<NextCheckChoice>();
export const nextCheckDateChanged = createEvent<string>();
/** Fired by the page whenever the route's `:id` changes (including the first mount) — these
 * are plain global stores, so nothing else stops a draft typed for one item leaking onto the
 * next one opened without a full page remount (see pages/call/ui.tsx). Also fired after a
 * successful save. */
export const formReset = createEvent();
export const submitRequested = createEvent<{ queueItemId: string }>();

export const $outcome = createStore<CallOutcome | null>(null).on(outcomeChanged, (_, v) => v).reset(formReset);
export const $foreigners = createStore(false).on(foreignersToggled, (_, v) => v).reset(formReset);
export const $familyOnly = createStore(false).on(familyOnlyToggled, (_, v) => v).reset(formReset);
export const $deposit = createStore("").on(depositChanged, (_, v) => v).reset(formReset);
export const $note = createStore("").on(noteChanged, (_, v) => v).reset(formReset);
export const $nextCheck = createStore<NextCheckChoice>("in_3_days").on(nextCheckChanged, (_, v) => v).reset(formReset);
export const $nextCheckDate = createStore("").on(nextCheckDateChanged, (_, v) => v).reset(formReset);

/** Drives the Save button's label — Bo'sh by default, Topshirilgan only once chosen (see spec). */
export const $resultingStatus = $outcome.map((o): ResultingStatus => (o === "taken" ? "taken" : "vacant"));

export const submitFx = createEffect((input: CallLogInput) => logCall(input));

sample({
  clock: submitRequested,
  source: { outcome: $outcome, foreigners: $foreigners, familyOnly: $familyOnly, deposit: $deposit, note: $note, nextCheck: $nextCheck, nextCheckDate: $nextCheckDate },
  fn: (form, { queueItemId }): CallLogInput => ({
    queueItemId,
    // the Save button stays disabled until an outcome is picked (see ui.tsx), so this is never null in practice
    outcome: form.outcome!,
    conditions: {
      foreigners: form.foreigners,
      familyOnly: form.familyOnly,
      depositMonths: form.deposit.trim() ? Number(form.deposit) : null,
    },
    note: form.note.trim(),
    nextCheck: { choice: form.nextCheck, date: form.nextCheck === "date" ? form.nextCheckDate : undefined },
  }),
  target: submitFx,
});

const toastFx = createEffect(() => { toast.success(i18n.t("call.saved")); });
// the lock is released the moment the log is saved — the team sees the item back in the open pool immediately
sample({ clock: submitFx.done, fn: ({ params }) => params.queueItemId, target: released });
sample({ clock: submitFx.done, target: [toastFx, formReset] });
sample({ clock: submitFx.done, fn: () => ({ params: {}, query: {} }), target: routes.queue.navigate });
