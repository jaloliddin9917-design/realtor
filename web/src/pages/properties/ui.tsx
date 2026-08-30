import { useTranslation } from "react-i18next";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { AppLayout } from "@/widgets/app-layout";

// Placeholder: Task 4 fills the list, filters and pagination in.
export function PropertiesPage() {
  const { t } = useTranslation();
  return <AppLayout title={t("properties.title")} actions={<LanguageSwitch />}>{null}</AppLayout>;
}
