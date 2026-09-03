import { useTranslation } from "react-i18next";
import { AppLayout } from "@/widgets/app-layout";

// Placeholder — replaced by the screen implementation.
export function DuplicatesPage() {
  const { t } = useTranslation();
  return (
    <AppLayout title={t("nav.duplicates")}>
      <p className="p-6 text-center text-muted-foreground">{t("app.loading")}</p>
    </AppLayout>
  );
}
