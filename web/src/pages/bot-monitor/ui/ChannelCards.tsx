import { useUnit } from "effector-react";
import { MessageSquare, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { $channels, type BotChannelKind, type ChannelStat } from "@/entities/bot";
import { cn } from "@/shared/lib";

const card = "flex flex-col gap-1.5 rounded-card border border-line bg-surface p-3.5";
const label = "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

const ICON: Record<BotChannelKind, typeof Send> = { telegram: Send, sms: MessageSquare };
const TITLE_KEY: Record<BotChannelKind, string> = { telegram: "bot.cards.telegramTitle", sms: "bot.cards.smsTitle" };

/** One card per channel — the API gives channel name, status, sent-today and its send limits;
 * unlike the original mock there is no account phone, quiet-hours or do-not-contact concept on
 * the backend, so those cards/sub-lines are dropped rather than faked. */
function ChannelCard({ stat }: { stat: ChannelStat }) {
  const { t } = useTranslation();
  const Icon = ICON[stat.channel];
  const ready = stat.status === "ready";
  return (
    <div className={card}>
      <span className={label}><Icon className="size-3.5" />{t(TITLE_KEY[stat.channel])}</span>
      <span className="num text-2xl font-bold">{t("bot.cards.count", { sent: stat.sentToday, limit: stat.perDay ?? "—" })}</span>
      <span className={cn(
        "mt-1 inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[13px] font-semibold",
        ready ? "bg-status-active-bg text-status-active" : "bg-status-unknown-bg text-status-unknown",
      )}>
        {t(ready ? "bot.cards.ready" : "bot.cards.notConfigured")}
      </span>
      <span className="text-xs text-muted-foreground">{t("bot.cards.limits", { perHour: stat.perHour ?? "—", perDay: stat.perDay ?? "—" })}</span>
    </div>
  );
}

export function ChannelCards() {
  const channels = useUnit($channels);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {channels.map((stat) => <ChannelCard key={stat.channel} stat={stat} />)}
    </div>
  );
}
