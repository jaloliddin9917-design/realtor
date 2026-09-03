import { useUnit } from "effector-react";
import { Ban, Clock, MessageSquare, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { $channels, $doNotContact, $quietHours, type ChannelStat } from "@/entities/bot";
import { formatPhone } from "@/shared/lib";

const card = "flex flex-col gap-1.5 rounded-card border border-line bg-surface p-3.5";
const label = "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

function TelegramCard({ stat }: { stat: ChannelStat }) {
  const { t } = useTranslation();
  return (
    <div className={card}>
      <span className={label}><Send className="size-3.5" />{t("bot.cards.telegramTitle")}</span>
      <span className="num text-2xl font-bold">{t("bot.cards.count", { sent: stat.sent_today, limit: stat.daily_limit })}</span>
      <span className="text-xs text-muted-foreground">{t("bot.cards.telegramSub", { phone: formatPhone(stat.account_phone ?? ""), perHour: stat.per_hour, until: stat.wait_until })}</span>
    </div>
  );
}

function SmsCard({ stat }: { stat: ChannelStat }) {
  const { t } = useTranslation();
  return (
    <div className={card}>
      <span className={label}><MessageSquare className="size-3.5" />{t("bot.cards.smsTitle")}</span>
      <span className="num text-2xl font-bold">{t("bot.cards.count", { sent: stat.sent_today, limit: stat.daily_limit })}</span>
      <span className="text-xs text-muted-foreground">{t("bot.cards.smsSub")}</span>
    </div>
  );
}

function QuietHoursCard() {
  const { t } = useTranslation();
  const quietHours = useUnit($quietHours);
  return (
    <div className={card}>
      <span className={label}><Clock className="size-3.5" />{t("bot.cards.quietHoursTitle")}</span>
      {quietHours.can_send_now && <span className="mt-1 inline-flex w-fit items-center rounded-full bg-status-active-bg px-2.5 py-1 text-[13px] font-semibold text-status-active">{t("bot.cards.quietHoursOk")}</span>}
      <span className="text-xs text-muted-foreground">{quietHours.start}–{quietHours.end}</span>
    </div>
  );
}

function DoNotContactCard() {
  const { t } = useTranslation();
  const dnc = useUnit($doNotContact);
  return (
    <div className={card}>
      <span className={label}><Ban className="size-3.5" />{t("bot.cards.dncTitle")}</span>
      <span className="text-[13px] text-ink">{t("bot.cards.dncSub", { when: `${t("bot.today")} ${dnc.last_stop_time}`, days: dnc.window_days, count: dnc.max_per_window })}</span>
    </div>
  );
}

export function ChannelCards() {
  const channels = useUnit($channels);
  const telegram = channels.find((c) => c.channel === "telegram");
  const sms = channels.find((c) => c.channel === "sms");
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {telegram && <TelegramCard stat={telegram} />}
      {sms && <SmsCard stat={sms} />}
      <QuietHoursCard />
      <DoNotContactCard />
    </div>
  );
}
