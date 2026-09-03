import { createEffect, createEvent, createStore, sample } from "effector";
import { toast } from "sonner";
import { addUser, userAdded, type UserRole } from "@/entities/setting";
import { i18n } from "@/shared/i18n";

export interface AddUserInput { name: string; phone: string; role: UserRole }

export const addRequested = createEvent<AddUserInput>();
export const dialogClosed = createEvent();
export const addUserFx = createEffect(addUser);
export const $added = createStore(false).on(addUserFx.done, () => true).reset(addRequested, dialogClosed);
const toastFx = createEffect(() => { toast.success(i18n.t("settingsPage.users.added")); });

sample({ clock: addRequested, target: addUserFx });
sample({ clock: addUserFx.doneData, target: userAdded });
sample({ clock: addUserFx.done, target: toastFx });
