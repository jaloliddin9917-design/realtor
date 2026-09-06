import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $duplicatesPending, $pairs } from "@/entities/duplicate";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { Skeleton } from "@/shared/ui/skeleton";
import { AppLayout } from "@/widgets/app-layout";
import { ComparePanel } from "./ui/ComparePanel";
import { QueuePanel } from "./ui/QueuePanel";

export function DuplicatesPage() {
  const { t } = useTranslation();
  const [pending, pairs] = useUnit([$duplicatesPending, $pairs]);
  return (
    <AppLayout title={t("nav.duplicates")} actions={<LanguageSwitch />}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        {pending && pairs.length === 0 ? (
          <>
            <Skeleton className="h-[520px] rounded-card" />
            <Skeleton className="h-[520px] rounded-card" />
          </>
        ) : (
          <>
            <QueuePanel />
            <ComparePanel />
          </>
        )}
      </div>
    </AppLayout>
  );
}
