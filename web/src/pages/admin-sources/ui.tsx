import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/widgets/app-layout";
import { SourcesTable } from "@/widgets/sources-table";
import { SourceToggle } from "@/features/source/toggle";
import { SourceRunNow } from "@/features/source/run-now";
import { AddTelegramDialog } from "@/features/source/add-telegram";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { $fx, $sources, $sourcesPending } from "@/entities/source";
import { Skeleton } from "@/shared/ui/skeleton";

export function AdminSourcesPage() {
  const { t } = useTranslation();
  const [sources, fx, pending] = useUnit([$sources, $fx, $sourcesPending]);
  const fxDays = fx ? Math.floor((Date.now() - new Date(fx.date).getTime()) / 86_400_000) : null;
  return (
    <AppLayout title={t("sources.title")} actions={<><AddTelegramDialog /><LanguageSwitch /></>}>
      {(fx === null || fx.stale) && <div className="rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-[13px] text-warn">{fx === null ? t("sources.fxMissing") : t("sources.fxStale", { days: fxDays })}</div>}
      {pending && sources.length === 0 ? <Skeleton className="h-40 w-full" /> : <SourcesTable sources={sources} renderToggle={(s) => <SourceToggle source={s} />} renderRun={(s) => <SourceRunNow source={s} />} />}
    </AppLayout>
  );
}
