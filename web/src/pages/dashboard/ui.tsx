import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $agentsToday } from "@/entities/agent";
import { $dashboardLoaded, $dashboardPending, $dashboardStats } from "@/entities/dashboard";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { Skeleton } from "@/shared/ui/skeleton";
import { AppLayout } from "@/widgets/app-layout";
import { AgentsCard } from "./ui/AgentsCard";
import { RecheckCard } from "./ui/RecheckCard";
import { Tile, TileBar } from "./ui/Tile";

const pct = (n: number, d: number) => (d > 0 ? Math.min(100, (n / d) * 100) : 0);

function DashboardSkeleton() {
  return (
    <>
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[132px] rounded-card" />)}
      </div>
      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Skeleton className="h-80 rounded-card" />
        <Skeleton className="h-80 rounded-card" />
      </div>
    </>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const [stats, agents, pending, loaded] = useUnit([$dashboardStats, $agentsToday, $dashboardPending, $dashboardLoaded]);
  const { vacant, toCheck, newListings, botReplies } = stats;
  const replies = botReplies.vacant + botReplies.submitted + botReplies.unclear;
  return (
    <AppLayout title={t("nav.dashboard")} actions={<LanguageSwitch />}>
      {pending && !loaded ? (
        <DashboardSkeleton />
      ) : (
        <>
          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            <Tile
              accent="bg-status-active"
              label={t("dashboard.stats.vacant")}
              value={vacant.total}
              sub={t("dashboard.stats.vacantSub", { count: vacant.confirmedWithin3Days })}
              foot={<TileBar segments={[{ pct: pct(vacant.confirmedWithin3Days, vacant.total), className: "bg-status-active" }]} />}
            />
            <Tile
              accent="bg-warn"
              label={t("dashboard.stats.toCheck")}
              value={toCheck.count}
              sub={t("dashboard.stats.toCheckSub")}
            />
            <Tile
              accent="bg-primary"
              label={t("dashboard.stats.newListings")}
              value={newListings.total}
              sub={t("dashboard.stats.newListingsBreakdown", { olx: newListings.olx, telegram: newListings.telegram, duplicates: newListings.duplicates })}
            />
            <Tile
              accent="bg-status-new"
              label={t("dashboard.stats.botReplies")}
              value={<>{botReplies.sent}<span className="ml-1.5 text-sm font-semibold text-muted-foreground">{t("dashboard.stats.sentOfTotal", { total: botReplies.total })}</span></>}
              foot={
                <div className="flex flex-col gap-1.5">
                  <TileBar segments={[
                    { pct: pct(botReplies.vacant, replies), className: "bg-status-active" },
                    { pct: pct(botReplies.submitted, replies), className: "bg-warn" },
                    { pct: pct(botReplies.unclear, replies), className: "bg-muted-foreground/40" },
                  ]} />
                  <div className="text-[11px] text-muted-foreground">{t("dashboard.stats.botRepliesBreakdown", { vacant: botReplies.vacant, submitted: botReplies.submitted, unclear: botReplies.unclear })}</div>
                </div>
              }
            />
          </div>

          <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
            <AgentsCard
              rows={agents.rows}
              callsTotal={agents.callsTotal}
              vacantFoundTotal={agents.vacantFoundTotal}
              duplicateCallsAvoided={agents.duplicateCallsAvoided}
              unassignedCount={stats.unassignedCount}
            />
            <RecheckCard total={stats.recheckTotal} items={stats.recheckItems} />
          </div>
        </>
      )}
    </AppLayout>
  );
}
