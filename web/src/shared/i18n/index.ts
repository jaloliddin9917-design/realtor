import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { LANG_STORAGE_KEY, SUPPORTED_LANGS } from "@/shared/config";
import ru from "./ru.json";
import uz from "./uz.json";

export const i18nReady = i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { uz: { translation: uz }, ru: { translation: ru } },
    fallbackLng: "uz",
    supportedLngs: [...SUPPORTED_LANGS],
    detection: { order: ["localStorage", "navigator"], caches: ["localStorage"], lookupLocalStorage: LANG_STORAGE_KEY },
    interpolation: { escapeValue: false },
    returnNull: false,
  });

export { i18n };
export * from "./keys";
