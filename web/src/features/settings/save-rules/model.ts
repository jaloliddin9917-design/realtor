import { createEffect, createEvent, sample } from "effector";
import { toast } from "sonner";
import { rulesSaved, saveRules, type Rules } from "@/entities/setting";
import { i18n } from "@/shared/i18n";

export const saveRequested = createEvent<Rules>();
export const saveRulesFx = createEffect(saveRules);
const toastFx = createEffect(() => { toast.success(i18n.t("settingsPage.rules.saved")); });

sample({ clock: saveRequested, target: saveRulesFx });
sample({ clock: saveRulesFx.doneData, target: rulesSaved });
sample({ clock: saveRulesFx.done, target: toastFx });
