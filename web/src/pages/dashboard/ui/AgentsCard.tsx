import { Link } from "atomic-router-react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentRow } from "@/entities/agent";
import { routes } from "@/shared/router";
import { buttonVariants } from "@/shared/ui/button";

const th = "whitespace-nowrap bg-surface-soft px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const td = "border-b border-line-soft px-3 py-2.5 align-middle";

/** `workingOn` is a raw string straight off the API (or null when idle) — there is no `kind`
 * telling us whether this is an active call or a scheduled callback, so unlike the old mock
 * this renders the text verbatim rather than composing a translated "active until"/"next
 * callback" sentence (and drops the lock icon that implied a call in progress specifically). */
function ActivityCell({ workingOn }: { workingOn: string | null }) {
  if (!workingOn) return <span className="text-muted-foreground">—</span>;
  return <span className="inline-flex items-center whitespace-nowrap rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-primary">{workingOn}</span>;
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
                <td className={`${td} num`}>{row.inQueue}</td>
                <td className={`${td} num`}>{row.calls}</td>
                <td className={`${td} num`}>{row.foundVacant}</td>
                <td className={td}><ActivityCell workingOn={row.workingOn} /></td>
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
