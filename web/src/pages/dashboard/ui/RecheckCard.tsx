import { Link } from "atomic-router-react";
import { useTranslation } from "react-i18next";
import type { RecheckItem } from "@/entities/dashboard";
import { districtKey, kindKey } from "@/shared/i18n";
import { formatUsdFromMinor } from "@/shared/lib";
import { routes } from "@/shared/router";
import { Badge } from "@/shared/ui/badge";
import { buttonVariants } from "@/shared/ui/button";

function RecheckRow({ item }: { item: RecheckItem }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line-soft p-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium">
          {t(districtKey(item.district))}, {item.place} · {t("properties.rooms", { count: item.rooms })} · <span className="num">{formatUsdFromMinor(item.priceUsdMinor)}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{t("dashboard.recheck.confirmedAgo", { days: item.confirmedDaysAgo })} · {item.agent}</span>
          {item.removedFrom && (
            <Badge variant="secondary" className="bg-status-inactive-bg text-status-inactive">
              {t("dashboard.recheck.removedFrom", { source: t(kindKey(item.removedFrom)) })}
            </Badge>
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
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{t("dashboard.recheck.title")}</h2>
          <Badge variant="secondary">{total}</Badge>
        </div>
        <span className="text-xs text-muted-foreground">{t("dashboard.recheck.oldestFirst")}</span>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item) => <RecheckRow key={item.id} item={item} />)}
      </div>
      {remaining > 0 && <span className="text-xs text-muted-foreground">{t("dashboard.recheck.more", { count: remaining })}</span>}
    </div>
  );
}
