import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $botPending, $rows } from "@/entities/bot";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { Skeleton } from "@/shared/ui/skeleton";
import { AppLayout } from "@/widgets/app-layout";
import { ChannelCards } from "./ui/ChannelCards";
import { CountersBar } from "./ui/CountersBar";
import { OutreachTable } from "./ui/OutreachTable";

export function BotMonitorPage() {
  const { t } = useTranslation();
  const [pending, rows] = useUnit([$botPending, $rows]);
  return (
    <AppLayout title={t("nav.bot")} actions={<LanguageSwitch />}>
      {pending && rows.length === 0 ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-24 rounded-card" />
            <Skeleton className="h-24 rounded-card" />
          </div>
          <Skeleton className="h-12 rounded-card" />
          <Skeleton className="h-80 rounded-card" />
        </>
      ) : (
        <>
          <ChannelCards />
          <CountersBar />
          <OutreachTable />
        </>
      )}
    </AppLayout>
  );
}
