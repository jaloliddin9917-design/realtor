import { useState } from "react";
import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $items, type QueueItem } from "@/entities/queue";
import { $user } from "@/entities/session";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { cn } from "@/shared/lib";
import { AppLayout } from "@/widgets/app-layout";
import { QueueCard } from "./ui/QueueCard";

type Tab = "today" | "retry" | "all";
const TAB_KEYS: Record<Tab, string> = { today: "queue.tabs.today", retry: "queue.tabs.retry", all: "queue.tabs.all" };
const DATE_LOCALES: Record<string, string> = { uz: "uz-Latn-UZ", ru: "ru-RU" };

/** "Shanba, 29-avgust" — the current date (Asia/Tashkent), localized. Purely decorative, so it
 * stays local to this page rather than becoming a shared/lib helper. */
function headerDate(locale: string): string {
  const formatted = new Intl.DateTimeFormat(DATE_LOCALES[locale] ?? "uz-Latn-UZ", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Tashkent" }).format(new Date());
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function visibleFor(tab: Tab, items: QueueItem[]): QueueItem[] {
  if (tab === "retry") return items.filter((i) => i.state.kind === "retry");
  if (tab === "today") return items.filter((i) => i.state.kind !== "retry");
  return items;
}

export function QueuePage() {
  const { t, i18n } = useTranslation();
  const [items, user] = useUnit([$items, $user]);
  const [tab, setTab] = useState<Tab>("today");

  const counts: Record<Tab, number> = {
    today: items.filter((i) => i.state.kind !== "retry").length,
    retry: items.filter((i) => i.state.kind === "retry").length,
    all: items.length,
  };
  const visible = visibleFor(tab, items);

  return (
    <AppLayout title={t("nav.queue")} actions={<LanguageSwitch />}>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-bold">{t("queue.heading")}</h2>
        <p className="text-sm text-muted-foreground">{t("queue.dateAgent", { date: headerDate(i18n.language), agent: user?.name ?? "" })}</p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist">
        {(Object.keys(TAB_KEYS) as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-semibold transition-colors",
              tab === key ? "border-primary bg-primary text-primary-foreground" : "border-line bg-surface text-muted-foreground hover:bg-surface-soft",
            )}
          >
            {t(TAB_KEYS[key])} · {counts[key]}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="p-6 text-center text-muted-foreground">{t("app.empty")}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((item) => <QueueCard key={item.id} item={item} />)}
        </div>
      )}
    </AppLayout>
  );
}
