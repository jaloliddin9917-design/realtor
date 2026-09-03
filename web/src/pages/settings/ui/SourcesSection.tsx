import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $sources, type SourceFeed } from "@/entities/setting";
import { AddChannelDialog } from "@/features/settings/add-channel";

function sourceLine(t: (key: string, opts?: Record<string, unknown>) => string, feed: SourceFeed): string {
  switch (feed.kind) {
    case "olx":
      return t("settingsPage.sources.olx", { interval: feed.interval_minutes, ago: feed.last_checked_minutes_ago, added: feed.added_today });
    case "telegram_channels":
      return t("settingsPage.sources.telegramChannels", { count: feed.handles?.length ?? 0, handles: (feed.handles ?? []).join(" · ") });
    case "other_portal":
      return t("settingsPage.sources.otherPortal");
  }
}

export function SourcesSection() {
  const { t } = useTranslation();
  const sources = useUnit($sources);
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3.5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t("sources.title")}</h2>
        <AddChannelDialog />
      </div>
      <ul className="flex flex-col gap-2">
        {sources.map((feed) => (
          <li key={feed.id} className="rounded-lg border border-line-soft bg-surface-soft px-3 py-2 text-[13px]">{sourceLine(t, feed)}</li>
        ))}
      </ul>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p>{t("settingsPage.sources.noteGone")}</p>
        <p>{t("settingsPage.sources.notePhash")}</p>
      </div>
    </div>
  );
}
