import { createEffect, createEvent, sample } from "effector";
import { toast } from "sonner";
import { patchSource, sourceUpserted } from "@/entities/source";
import { isApiProblem } from "@/shared/api";
import { i18n, problemKey } from "@/shared/i18n";

export const toggleRequested = createEvent<{ id: string; enabled: boolean }>();
export const toggleFx = createEffect(({ id, enabled }: { id: string; enabled: boolean }) => patchSource(id, enabled));
const toastErrorFx = createEffect((e: unknown) => { toast.error(i18n.t(isApiProblem(e) ? problemKey(e.code) : "errors.network")); });
sample({ clock: toggleRequested, target: toggleFx });
sample({ clock: toggleFx.doneData, target: sourceUpserted });
sample({ clock: toggleFx.failData, target: toastErrorFx });
