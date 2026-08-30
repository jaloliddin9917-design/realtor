import { createEffect, createEvent, createStore, sample } from "effector";
import { i18n } from "@/shared/i18n";
import type { Lang } from "@/shared/config";

export const languageChanged = createEvent<Lang>();
const changeLanguageFx = createEffect(async (lang: Lang) => { await i18n.changeLanguage(lang); return lang; });
export const $lang = createStore<Lang>((i18n.language?.startsWith("ru") ? "ru" : "uz") as Lang).on(changeLanguageFx.doneData, (_, l) => l);
sample({ clock: languageChanged, target: changeLanguageFx });
