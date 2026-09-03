import { sample, createEvent } from "effector";
import { take, takeFx } from "@/entities/queue";
import { routes } from "@/shared/router";

/** The "Olish va qo'ng'iroq qilish" / "Qayta urinish" click: claim the item, then — once the
 * claim actually succeeds — open its call-log screen. A lost race (409 queue.locked) surfaces as
 * a toast from entities/queue and does NOT navigate. */
export const takeRequested = createEvent<string>();

sample({ clock: takeRequested, target: take });
sample({ clock: takeFx.done, fn: ({ params }) => ({ params: { id: params }, query: {} }), target: routes.call.navigate });
