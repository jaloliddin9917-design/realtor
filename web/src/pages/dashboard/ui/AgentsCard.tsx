import { Link } from "atomic-router-react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentRow } from "@/entities/agent";
import { cn } from "@/shared/lib";
import { routes } from "@/shared/router";
import { buttonVariants } from "@/shared/ui/button";

function Metric({ value, label, hi }: { value: number; label: string; hi?: boolean }) {
  return (
    <div className="text-right">
      <div className={cn("num text-base font-bold leading-none tracking-tight", hi && "text-status-active")}>{value}</div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function AgentRowView({ row }: { row: AgentRow }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line-soft px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 flex-none place-items-center rounded-[10px] bg-primary text-sm font-bold text-primary-foreground">{row.name.charAt(0)}</span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{row.name}</div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {row.workingOn
              ? <><span className="size-1.5 flex-none rounded-full bg-status-active ring-2 ring-status-active-bg" />{row.workingOn}</>
              : "—"}
          </div>
        </div>
      </div>
      <div className="flex gap-5">
        <Metric value={row.inQueue} label={t("dashboard.agents.short.queued")} />
        <Metric value={row.calls} label={t("dashboard.agents.short.calls")} />
        <Metric value={row.foundVacant} label={t("dashboard.agents.short.found")} hi />
      </div>
    </div>
  );
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
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5">
        <h2 className="text-sm font-bold">{t("dashboard.agents.title")}</h2>
        <span className="text-[11px] text-muted-foreground">
          {t("dashboard.agents.summary", { calls: callsTotal, vacantFound: vacantFoundTotal, avoided: duplicateCallsAvoided })}
        </span>
      </div>
      {rows.map((row) => <AgentRowView key={row.id} row={row} />)}
      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-soft px-4 py-3">
        <span className="flex items-center gap-2 text-[13px]">
          <span className="size-[7px] flex-none rounded-full bg-warn" />{t("dashboard.unassigned", { count: unassignedCount })}
        </span>
        <Link to={routes.queue} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-auto")}>
          {t("dashboard.openQueue")}<ChevronRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}
