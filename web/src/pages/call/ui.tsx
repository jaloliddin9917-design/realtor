import { useTranslation } from "react-i18next";
import { AppLayout } from "@/widgets/app-layout";

// Placeholder — replaced by the screen implementation.
export function CallPage() {
  const { t } = useTranslation();
  return (
    <AppLayout title={t("nav.queue")}>
      <p className="p-6 text-center text-muted-foreground">{t("app.loading")}</p>
    </AppLayout>
  );
}
