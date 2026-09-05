import { useTranslation } from "react-i18next";
import type { Source } from "@/entities/source";
import { cn, formatDate } from "@/shared/lib";
import { kindKey, sourceStatusKey } from "@/shared/i18n";

const STATUS: Record<Source["status"], string> = { ok: "bg-status-active-bg text-status-active", failing: "bg-status-inactive-bg text-status-inactive", login_required: "bg-warn-bg text-warn", paused: "bg-warn-bg text-warn", misconfigured: "bg-status-inactive-bg text-status-inactive" };

export function SourcesTable({ sources, renderToggle, renderRun }: { sources: Source[]; renderToggle: (s: Source) => React.ReactNode; renderRun: (s: Source) => React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const th = "whitespace-nowrap bg-surface-soft px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
  const td = "border-b border-line-soft px-3 py-2.5 align-middle";
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
      <table className="w-full border-collapse text-[13px]">
        <thead><tr>{(["name", "kind", "enabled", "status", "lastRun", "nextRun", "failures", "error", "action"] as const).map((c) => <th key={c} className={th}>{t(`sources.columns.${c}`)}</th>)}</tr></thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id}>
              <td className={`${td} font-medium`}>{s.name}</td>
              <td className={td}>{t(kindKey(s.kind))}</td>
              <td className={td}>{renderToggle(s)}</td>
              <td className={td}><span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold", STATUS[s.status])}>{t(sourceStatusKey(s.status))}</span></td>
              <td className={`${td} num`}>{s.last_run ? <div><div>{formatDate(s.last_run.started_at, i18n.language, "datetime")}</div><div className="text-xs text-muted-foreground">{t("sources.columns.found")} {s.last_run.found} · {t("sources.columns.new")} {s.last_run.new}</div></div> : <span className="text-muted-foreground">{t("sources.never")}</span>}</td>
              <td className={`${td} num`}>{formatDate(s.next_run_at, i18n.language, "datetime")}</td>
              <td className={`${td} num`}>{s.consecutive_failures}</td>
              <td className={`${td} max-w-64 truncate text-xs text-status-inactive`} title={s.last_run?.error ?? ""}>{s.last_run?.error ?? ""}</td>
              <td className={td}>{renderRun(s)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
