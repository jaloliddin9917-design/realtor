import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $agentsToday } from "@/entities/agent";
import { $dashboardStats } from "@/entities/dashboard";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { AppLayout } from "@/widgets/app-layout";
import { AgentsCard } from "./ui/AgentsCard";
import { RecheckCard } from "./ui/RecheckCard";
import { StatCard } from "./ui/StatCard";

export function DashboardPage() {
  const { t } = useTranslation();
  const [stats, agents] = useUnit([$dashboardStats, $agentsToday]);
  return (
    <AppLayout title={t("nav.dashboard")} actions={<LanguageSwitch />}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("dashboard.stats.vacant")}
          value={stats.vacant.total}
          sub={t("dashboard.stats.vacantSub", { count: stats.vacant.confirmedWithin3Days })}
        />
        <StatCard
          label={t("dashboard.stats.toCheck")}
          value={stats.toCheck.count}
          sub={t("dashboard.stats.toCheckSub")}
        />
        <StatCard
          label={t("dashboard.stats.newListings")}
          value={stats.newListings.total}
          sub={t("dashboard.stats.newListingsBreakdown", { olx: stats.newListings.olx, telegram: stats.newListings.telegram, duplicates: stats.newListings.duplicates })}
        />
        <StatCard
          label={t("dashboard.stats.botReplies")}
          value={<>{stats.botReplies.sent}<span className="ml-1 text-sm font-normal text-muted-foreground">{t("dashboard.stats.sentOfTotal", { total: stats.botReplies.total })}</span></>}
          sub={t("dashboard.stats.botRepliesBreakdown", { vacant: stats.botReplies.vacant, submitted: stats.botReplies.submitted, unclear: stats.botReplies.unclear })}
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <AgentsCard
          rows={agents.rows}
          callsTotal={agents.callsTotal}
          vacantFoundTotal={agents.vacantFoundTotal}
          duplicateCallsAvoided={agents.duplicateCallsAvoided}
          unassignedCount={stats.unassignedCount}
        />
        <RecheckCard total={stats.recheckTotal} items={stats.recheckItems} />
      </div>
    </AppLayout>
  );
}
