import { sample, createEvent } from "effector";
import { take } from "@/entities/queue";
import { routes } from "@/shared/router";

/** The "Olish va qo'ng'iroq qilish" / "Qayta urinish" click: lock the item as mine, then go
 * straight to the call-log screen for it. */
export const takeRequested = createEvent<string>();

sample({ clock: takeRequested, target: take });
sample({ clock: takeRequested, fn: (id) => ({ params: { id }, query: {} }), target: routes.call.navigate });
