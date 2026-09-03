import { Link } from "atomic-router-react";
import { ChevronRight, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentActivity, AgentRow } from "@/entities/agent";
import { districtKey } from "@/shared/i18n";
import { routes } from "@/shared/router";
import { buttonVariants } from "@/shared/ui/button";

const th = "whitespace-nowrap bg-surface-soft px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const td = "border-b border-line-soft px-3 py-2.5 align-middle";

function ActivityCell({ activity }: { activity: AgentActivity }) {
  const { t } = useTranslation();
  if (activity.kind === "idle") return <span className="text-muted-foreground">—</span>;
  const place = `${t(districtKey(activity.district))} · ${t("properties.rooms", { count: activity.rooms })}`;
  if (activity.kind === "active") {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-primary">
        <Lock className="size-3" />{t("dashboard.agents.activeUntil", { place, time: activity.time })}
      </span>
    );
  }
  return <span className="text-muted-foreground">{t("dashboard.agents.callbackNext", { place, time: activity.time })}</span>;
}

export function AgentsCard({ rows, callsTotal, vacantFoundTotal, duplicateCallsAvoided, unassignedCount }: {
  rows: AgentRow[];
  callsTotal: number;
  vacantFoundTotal: number;
  duplicateCallsAvoided: number;
  unassignedCount: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("dashboard.agents.title")}</h2>
        <span className="text-xs text-muted-foreground">
          {t("dashboard.agents.summary", { calls: callsTotal, vacantFound: vacantFoundTotal, avoided: duplicateCallsAvoided })}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={th}>{t("dashboard.agents.columns.agent")}</th>
              <th className={th}>{t("dashboard.agents.columns.queued")}</th>
              <th className={th}>{t("dashboard.agents.columns.calls")}</th>
              <th className={th}>{t("dashboard.agents.columns.vacantFound")}</th>
              <th className={th}>{t("dashboard.agents.columns.current")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className={`${td} font-medium`}>{row.name}</td>
                <td className={`${td} num`}>{row.queued}</td>
                <td className={`${td} num`}>{row.calls}</td>
                <td className={`${td} num`}>{row.vacantFound}</td>
                <td className={td}><ActivityCell activity={row.activity} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
        <span className="text-sm">{t("dashboard.unassigned", { count: unassignedCount })}</span>
        <Link to={routes.queue} className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("dashboard.openQueue")}<ChevronRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}
