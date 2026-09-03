import { createEffect, createEvent, sample } from "effector";
import { toast } from "sonner";
import { outreachResolved, type OutreachResult } from "@/entities/bot";
import { i18n } from "@/shared/i18n";

export type ResolvedResult = Extract<OutreachResult, "vacant" | "taken">;

export const resolveRequested = createEvent<{ id: string; result: ResolvedResult }>();
/** Mock: a real backend would record which agent resolved the reply and when. */
export const resolveFx = createEffect(async (p: { id: string; result: ResolvedResult }) => p);
const toastFx = createEffect(() => { toast.success(i18n.t("bot.resolvedToast")); });

sample({ clock: resolveRequested, target: resolveFx });
sample({ clock: resolveFx.doneData, target: outreachResolved });
sample({ clock: resolveFx.done, target: toastFx });
