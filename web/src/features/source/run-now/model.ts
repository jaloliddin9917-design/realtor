import { createEffect, createEvent, sample } from "effector";
import { toast } from "sonner";
import { runSourceNow, sourceUpserted } from "@/entities/source";
import { isApiProblem } from "@/shared/api";
import { i18n, problemKey } from "@/shared/i18n";

/** "Fetch now" — mark the source due; the running worker crawls it within a tick (see the API). */
export const runRequested = createEvent<string>();
export const runFx = createEffect((id: string) => runSourceNow(id));

const toastQueuedFx = createEffect(() => { toast.success(i18n.t("sources.runQueued")); });
const toastErrorFx = createEffect((e: unknown) => { toast.error(i18n.t(isApiProblem(e) ? problemKey(e.code) : "errors.network")); });

sample({ clock: runRequested, target: runFx });
sample({ clock: runFx.doneData, target: sourceUpserted }); // reflect the new next_run_at in the table
sample({ clock: runFx.done, target: toastQueuedFx });
sample({ clock: runFx.failData, target: toastErrorFx });
