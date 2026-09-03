import { useTranslation } from "react-i18next";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { AppLayout } from "@/widgets/app-layout";
import { ComparePanel } from "./ui/ComparePanel";
import { QueuePanel } from "./ui/QueuePanel";

export function DuplicatesPage() {
  const { t } = useTranslation();
  return (
    <AppLayout title={t("nav.duplicates")} actions={<LanguageSwitch />}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <QueuePanel />
        <ComparePanel />
      </div>
    </AppLayout>
  );
}
