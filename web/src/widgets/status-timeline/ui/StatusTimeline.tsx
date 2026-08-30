import { useTranslation } from "react-i18next";
import type { StatusEvent } from "@/entities/property";
import { actorKey, statusKey } from "@/shared/i18n";
import { formatDate } from "@/shared/lib";

export function StatusTimeline({ events }: { events: StatusEvent[] }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="rounded-card border border-line bg-surface p-3.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("property.timeline")}</span>
      {/* the API returns the events newest first — the order the agent reads them in */}
      <ol className="mt-2 flex flex-col gap-2 border-l border-line pl-3">
        {events.map((e) => (
          <li key={e.id} className="text-[13px]">
            <div>{t(actorKey(e.actor_type))} — <b>{t(statusKey(e.to_status))}</b>{e.note && <> · <q>{e.note}</q></>}</div>
            <div className="num text-xs text-muted-foreground">{formatDate(e.created_at, i18n.language, "datetime")}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
