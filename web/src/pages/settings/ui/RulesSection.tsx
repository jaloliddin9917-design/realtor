import { useTranslation } from "react-i18next";
import { RulesForm } from "@/features/settings/save-rules";

export function RulesSection() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3.5">
      <h2 className="text-base font-semibold">{t("settingsPage.rules.title")}</h2>
      <RulesForm />
    </div>
  );
}
