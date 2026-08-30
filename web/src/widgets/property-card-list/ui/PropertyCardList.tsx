import { Link } from "atomic-router-react";
import { useTranslation } from "react-i18next";
import { OwnerBadge, PropertyTitle, StatusPill, type PropertyRow } from "@/entities/property";
import { kindKey } from "@/shared/i18n";
import { formatUsdFromMinor } from "@/shared/lib";
import { routes } from "@/shared/router";

/** The narrow (< lg) rendering of the list; `PropertyTable` is the wide one. */
export function PropertyCardList({ rows }: { rows: PropertyRow[] }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <Link key={row.id} to={routes.property} params={{ id: row.id }} className="flex gap-3 rounded-card border border-line bg-surface p-3 text-ink">
          {row.photo_url
            ? <img src={row.photo_url} alt="" className="size-16 flex-none rounded-lg object-cover" />
            : <div className="size-16 flex-none rounded-lg bg-[#d8e2df]" />}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-start justify-between gap-2">
              <PropertyTitle row={row} />
              <span className="num font-semibold">{formatUsdFromMinor(row.price_usd_min_minor)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <StatusPill status={row.status} />
              <span className="text-xs text-muted-foreground">{row.listing_count} · {row.source_kinds.map((k) => t(kindKey(k))).join(" · ")}</span>
            </div>
            <OwnerBadge owner={row.probable_owner} />
          </div>
        </Link>
      ))}
    </div>
  );
}
