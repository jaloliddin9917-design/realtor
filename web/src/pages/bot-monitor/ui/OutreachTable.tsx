import { Link } from "atomic-router-react";
import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $rows, formatTime, type OutreachResult, type OutreachRow } from "@/entities/bot";
import { ResolveUnclearButtons } from "@/features/bot/resolve-unclear";
import { districtKey } from "@/shared/i18n";
import { cn, formatPhone, formatUsdFromMinor } from "@/shared/lib";
import { routes } from "@/shared/router";

const RESULT_STYLE: Record<OutreachResult, string> = {
  vacant: "bg-status-active-bg text-status-active",
  taken: "bg-status-inactive-bg text-status-inactive",
  unclear: "bg-warn-bg text-warn",
  waiting: "bg-status-new-bg text-status-new",
  queued: "bg-status-unknown-bg text-status-unknown",
  error: "bg-status-inactive-bg text-status-inactive",
};

const th = "whitespace-nowrap bg-surface-soft px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const td = "border-b border-line-soft px-3 py-2.5 align-middle";

/** No street/assigned-agent here — the API carries neither field for an outreach row (unlike
 * the original mock), so the title collapses to district · rooms · price rather than faking
 * the rest. */
function PropertyCell({ row }: { row: OutreachRow }) {
  const { t } = useTranslation();
  const district = row.district ? t(districtKey(row.district)) : "—";
  const title = `${district} · ${t("bot.table.rooms", { count: row.rooms })} · ${formatUsdFromMinor(row.priceUsdMinor)}`;
  return <span className="font-medium">{title}</span>;
}

function ContactCell({ row }: { row: OutreachRow }) {
  const { t } = useTranslation();
  return <span className="num whitespace-nowrap">{formatPhone(row.phone)} · {t(`bot.channel.${row.channel}`)}</span>;
}

function SentReplyCell({ row }: { row: OutreachRow }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  if (row.result === "queued") return <span className="text-muted-foreground">{t("bot.table.notSentYet")}</span>;
  if (row.result === "error") return <span className="text-warn">{t("bot.table.sendError")}</span>;
  if (row.result === "waiting") return <span>{t("bot.table.noReplyYet", { sent: formatTime(row.sentAt, lang), hours: row.noReplyHours })}</span>;
  return <span>{t("bot.table.repliedAt", { sent: formatTime(row.sentAt, lang), reply: row.replyText, at: formatTime(row.repliedAt, lang) })}</span>;
}

/** Unclear replies get the resolve buttons; a classified reply links back to the list (no
 * fabricated property id); everything else (queued / still waiting / send failed) has no
 * action to offer yet. */
function ActionCell({ row }: { row: OutreachRow }) {
  const { t } = useTranslation();
  switch (row.result) {
    case "unclear":
      return <ResolveUnclearButtons id={row.id} />;
    case "vacant":
    case "taken":
      return <Link to={routes.properties} className="text-sm font-medium text-primary">{t("bot.table.openProperty")}</Link>;
    default:
      return <span className="text-muted-foreground">—</span>;
  }
}

export function OutreachTable() {
  const { t } = useTranslation();
  const rows = useUnit($rows);

  if (rows.length === 0) {
    return <p className="rounded-card border border-line bg-surface p-6 text-center text-muted-foreground">{t("bot.emptyState")}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={th}>{t("bot.columns.property")}</th>
            <th className={th}>{t("bot.columns.contact")}</th>
            <th className={th}>{t("bot.columns.sentReply")}</th>
            <th className={th}>{t("bot.columns.result")}</th>
            <th className={th}>{t("bot.columns.action")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-surface-soft">
              <td className={td}><PropertyCell row={row} /></td>
              <td className={td}><ContactCell row={row} /></td>
              <td className={td}><SentReplyCell row={row} /></td>
              <td className={td}><span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold", RESULT_STYLE[row.result])}>{t(`bot.result.${row.result}`)}</span></td>
              <td className={td}><ActionCell row={row} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
