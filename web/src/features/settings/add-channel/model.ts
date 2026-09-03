import { createEffect, createEvent, createStore, sample } from "effector";
import { toast } from "sonner";
import { addSourceChannel } from "@/entities/setting";
import { i18n } from "@/shared/i18n";

/**
 * The Settings screen's "Manbalar" section shows a static overview, not a live list (that
 * list is `pages/admin-sources`), so there is nothing here for a new channel to append to —
 * this mocks the round trip and reuses the real `sources.*` copy (same action, same words).
 */
export const addRequested = createEvent<string>();
export const dialogClosed = createEvent();
export const addChannelFx = createEffect(addSourceChannel);
export const $added = createStore(false).on(addChannelFx.done, () => true).reset(addRequested, dialogClosed);
const toastFx = createEffect(() => { toast.success(i18n.t("sources.added")); });

sample({ clock: addRequested, target: addChannelFx });
sample({ clock: addChannelFx.done, target: toastFx });
