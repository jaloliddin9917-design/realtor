import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $botChannels, type BotChannelSetting } from "@/entities/setting";
import { formatPhone } from "@/shared/lib";

function channelLine(t: (key: string, opts?: Record<string, unknown>) => string, ch: BotChannelSetting): string {
  const status = t(ch.connected ? "settingsPage.connected" : "settingsPage.disabled");
  switch (ch.kind) {
    case "telegram":
      return t("settingsPage.channels.telegram", { priority: ch.priority, phone: formatPhone(ch.account_phone ?? ""), perHour: ch.per_hour, perDay: ch.per_day, status });
    case "sms":
      return t("settingsPage.channels.sms", { priority: ch.priority, sender: ch.sender, status });
    case "voice":
      return t("settingsPage.channels.voice");
  }
}

export function ChannelsSection() {
  const { t } = useTranslation();
  const channels = useUnit($botChannels);
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3.5">
      <h2 className="text-base font-semibold">{t("settingsPage.channels.title")}</h2>
      <ul className="flex flex-col gap-2">
        {channels.map((ch) => (
          <li key={ch.id} className="rounded-lg border border-line-soft bg-surface-soft px-3 py-2 text-[13px]">{channelLine(t, ch)}</li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t("settingsPage.channels.note")}</p>
    </div>
  );
}
