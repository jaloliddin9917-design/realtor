import { Link } from "atomic-router-react";
import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $rows, type OutreachResult, type OutreachRow } from "@/entities/bot";
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
};

const th = "whitespace-nowrap bg-surface-soft px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const td = "border-b border-line-soft px-3 py-2.5 align-middle";

function PropertyCell({ row }: { row: OutreachRow }) {
  const { t } = useTranslation();
  const title = `${t(districtKey(row.district))}, ${row.street} · ${t("bot.table.rooms", { count: row.rooms })} · ${formatUsdFromMinor(row.price_usd_minor)} · ${row.agent ?? t("bot.table.unassigned")}`;
  return <span className="font-medium">{title}</span>;
}

function ContactCell({ row }: { row: OutreachRow }) {
  const { t } = useTranslation();
  return <span className="num whitespace-nowrap">{formatPhone(row.phone)} · {t(`bot.channel.${row.channel}`)}</span>;
}

function SentReplyCell({ row }: { row: OutreachRow }) {
  const { t } = useTranslation();
  if (row.result === "queued") return <span className="text-muted-foreground">{t("bot.table.notSentYet")}</span>;
  if (row.result === "waiting") return <span>{t("bot.table.noReplyYet", { sent: row.sent_at, hours: row.no_reply_hours })}</span>;
  return <span>{t("bot.table.repliedAt", { sent: row.sent_at, reply: row.reply_text, at: row.replied_at })}</span>;
}

function ActionCell({ row }: { row: OutreachRow }) {
  const { t } = useTranslation();
  switch (row.result) {
    case "unclear":
      return <ResolveUnclearButtons id={row.id} />;
    case "waiting":
      return <span className="text-xs text-muted-foreground">{t("bot.table.followUp", { when: `${t("bot.today")} ${row.follow_up_time}`, agent: row.follow_up_agent })}</span>;
    case "queued":
      return <span className="text-muted-foreground">—</span>;
    default:
      return <Link to={routes.properties} className="text-sm font-medium text-primary">{t("bot.table.openProperty")}</Link>;
  }
}

export function OutreachTable() {
  const { t } = useTranslation();
  const rows = useUnit($rows);
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
