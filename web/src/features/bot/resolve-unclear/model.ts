import { createEffect, createEvent, sample } from "effector";
import { toast } from "sonner";
import { fetchBotFx, outreachResolved, resolveOutreachMessage, type OutreachResult } from "@/entities/bot";
import { isApiProblem } from "@/shared/api";
import { i18n, problemKey } from "@/shared/i18n";

export type ResolvedResult = Extract<OutreachResult, "vacant" | "taken">;

export const resolveRequested = createEvent<{ id: string; result: ResolvedResult }>();
export const resolveFx = createEffect(({ id, result }: { id: string; result: ResolvedResult }) => resolveOutreachMessage(id, result));
const toastFx = createEffect(() => { toast.success(i18n.t("bot.resolvedToast")); });

sample({ clock: resolveRequested, target: resolveFx });
sample({ clock: resolveFx.doneData, target: outreachResolved });
sample({ clock: resolveFx.done, target: toastFx });

const toastErrorFx = createEffect((e: unknown) => {
  toast.error(i18n.t(isApiProblem(e) ? problemKey(e.code) : "errors.network"));
});
sample({ clock: resolveFx.failData, target: toastErrorFx });

// someone else (another agent, another tab) already resolved this reply, or it's no longer
// awaiting one — the local row is stale, so resync it (mirrors features/duplicate/decide's
// resync on a 409 dedupe.already_decided race).
sample({
  clock: resolveFx.failData,
  filter: (e) => isApiProblem(e) && e.code === "outreach.not_resolvable",
  target: fetchBotFx,
});
