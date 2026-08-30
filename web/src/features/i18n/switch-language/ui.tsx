import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGS } from "@/shared/config";
import { cn } from "@/shared/lib";
import { $lang, languageChanged } from "./model";

export function LanguageSwitch() {
  const { t } = useTranslation();
  const [lang, change] = useUnit([$lang, languageChanged]);
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-input text-xs font-semibold" role="group" aria-label="language">
      {SUPPORTED_LANGS.map((l) => (
        <button key={l} type="button" onClick={() => change(l)} aria-pressed={lang === l}
          className={cn("px-2 py-1", lang === l ? "bg-ink text-white" : "bg-surface text-muted-foreground")}>
          {t(`lang.${l}`)}
        </button>
      ))}
    </div>
  );
}
