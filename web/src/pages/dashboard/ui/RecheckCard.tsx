import { Link } from "atomic-router-react";
import { useTranslation } from "react-i18next";
import type { RecheckItem } from "@/entities/dashboard";
import { districtKey, kindKey } from "@/shared/i18n";
import { cn, formatUsdFromMinor } from "@/shared/lib";
import { routes } from "@/shared/router";
import { Badge } from "@/shared/ui/badge";
import { buttonVariants } from "@/shared/ui/button";

/** Severity stripe: removed-from-source or long overdue reads critical, a few days over reads
 * warning, the rest a quiet neutral — so the list scans by urgency, oldest/most-at-risk first. */
function urgencyStripe(item: RecheckItem): string {
  if (item.removedFrom || item.confirmedDaysAgo >= 7) return "bg-status-inactive";
  if (item.confirmedDaysAgo >= 5) return "bg-warn";
  return "bg-muted-foreground/30";
}

function RecheckRow({ item }: { item: RecheckItem }) {
  const { t } = useTranslation();
  const overdue = item.confirmedDaysAgo >= 7;
  return (
    <div className="flex items-center gap-3 border-t border-line-soft px-4 py-3">
      <span className={cn("w-[3px] flex-none self-stretch rounded-full", urgencyStripe(item))} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold">
          {t(districtKey(item.district))}, {item.place} · {t("properties.rooms", { count: item.rooms })}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <span className={cn(overdue && "font-semibold text-status-inactive")}>{t("dashboard.recheck.confirmedAgo", { days: item.confirmedDaysAgo })}</span>
          <span>· <span className="num">{formatUsdFromMinor(item.priceUsdMinor)}</span></span>
          {item.removedFrom && (
            <Badge variant="secondary" className="bg-warn-bg text-warn">{t("dashboard.recheck.removedFrom", { source: t(kindKey(item.removedFrom)) })}</Badge>
          )}
        </div>
      </div>
      <Link to={routes.queue} className={buttonVariants({ variant: "outline", size: "sm" })}>{t("dashboard.recheck.action")}</Link>
    </div>
  );
}

export function RecheckCard({ total, items }: { total: number; items: RecheckItem[] }) {
  const { t } = useTranslation();
  const remaining = total - items.length;
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold">{t("dashboard.recheck.title")}</h2>
          <Badge variant="secondary">{total}</Badge>
        </div>
        <span className="text-[11px] text-muted-foreground">{t("dashboard.recheck.oldestFirst")}</span>
      </div>
      {items.map((item) => <RecheckRow key={item.id} item={item} />)}
      {remaining > 0 && (
        <div className="border-t border-line-soft px-4 py-3 text-center">
          <Link to={routes.queue} className="text-xs font-semibold text-muted-foreground hover:text-ink">{t("dashboard.recheck.more", { count: remaining })} →</Link>
        </div>
      )}
    </div>
  );
}
