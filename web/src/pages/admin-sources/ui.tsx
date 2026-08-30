import { useTranslation } from "react-i18next";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { AppLayout } from "@/widgets/app-layout";

// Placeholder: Task 6 fills the sources table and the add-channel dialog in.
export function AdminSourcesPage() {
  const { t } = useTranslation();
  return <AppLayout title={t("sources.title")} actions={<LanguageSwitch />}>{null}</AppLayout>;
}
