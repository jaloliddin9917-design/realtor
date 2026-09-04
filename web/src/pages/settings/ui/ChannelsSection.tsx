import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $channels, type ChannelStat } from "@/entities/bot";

function channelLine(t: (key: string, opts?: Record<string, unknown>) => string, ch: ChannelStat): string {
  const status = t(ch.status === "ready" ? "bot.cards.ready" : "bot.cards.notConfigured");
  return t("settingsPage.channels.line", { channel: t(`bot.channel.${ch.channel}`), status, perHour: ch.perHour ?? "—", perDay: ch.perDay ?? "—" });
}

/**
 * Real `GET /api/v1/bot` channels — the same `$channels`/`fetchBotFx` the Bot Monitor screen
 * (pages/bot-monitor) renders (see app/router.ts's `authorized.settings.opened` wiring), not a
 * settings-local copy. Telegram and SMS only: the backend has no voice channel, so unlike the
 * old mock's third row nothing is shown for it — dropped rather than faked. No account phone or
 * sender field either — the API carries none of that.
 */
export function ChannelsSection() {
  const { t } = useTranslation();
  const channels = useUnit($channels);
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3.5">
      <h2 className="text-base font-semibold">{t("settingsPage.channels.title")}</h2>
      <ul className="flex flex-col gap-2">
        {channels.map((ch) => (
          <li key={ch.channel} className="rounded-lg border border-line-soft bg-surface-soft px-3 py-2 text-[13px]">{channelLine(t, ch)}</li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t("settingsPage.channels.note")}</p>
    </div>
  );
}
