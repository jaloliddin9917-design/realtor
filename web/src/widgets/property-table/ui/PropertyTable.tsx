import { Link } from "atomic-router-react";
import { useTranslation } from "react-i18next";
import { OwnerBadge, PropertyTitle, StatusPill, type PropertyRow } from "@/entities/property";
import { actorKey, kindKey } from "@/shared/i18n";
import { formatDate, formatUsdFromMinor } from "@/shared/lib";
import { routes } from "@/shared/router";

const th = "whitespace-nowrap bg-surface-soft px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const td = "border-b border-line-soft px-3 py-2.5 align-middle";

/** The wide (≥ lg) rendering of the list; `PropertyCardList` is the narrow one. */
export function PropertyTable({ rows }: { rows: PropertyRow[] }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={th}>{t("properties.columns.property")}</th>
            <th className={th}>{t("properties.columns.price")}</th>
            <th className={th}>{t("properties.columns.status")}</th>
            <th className={th}>{t("properties.columns.owner")}</th>
            <th className={th}>{t("properties.columns.listings")}</th>
            <th className={th}>{t("properties.columns.lastEvent")}</th>
            <th className={th}>{t("properties.columns.seen")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-surface-soft">
              <td className={td}>
                <Link to={routes.property} params={{ id: row.id }} className="flex items-center gap-2.5 text-ink">
                  {/* thumbnail — the wide table showed no photo before, only the title (see PropertyCardList for the narrow one) */}
                  {row.photo_url
                    ? <img src={row.photo_url} alt="" className="size-11 flex-none rounded-md object-cover" />
                    : <div className="size-11 flex-none rounded-md bg-line" />}
                  <div className="min-w-0">
                    <PropertyTitle row={row} />
                    {row.source_removed && <span className="mt-1 inline-block rounded bg-status-new-bg px-1.5 text-[11px] text-status-new">{t("properties.removedBadge")}</span>}
                  </div>
                </Link>
              </td>
              <td className={td}><div className="num font-semibold">{formatUsdFromMinor(row.price_usd_min_minor)}</div></td>
              <td className={td}><StatusPill status={row.status} /></td>
              <td className={td}><OwnerBadge owner={row.probable_owner} /></td>
              <td className={`${td} whitespace-nowrap`}>
                <span className="rounded bg-bg px-2 py-0.5 text-xs font-medium">{row.listing_count}</span>{" "}
                <span className="text-xs text-muted-foreground">{row.source_kinds.map((k) => t(kindKey(k))).join(" · ")}</span>
              </td>
              <td className={td}>
                {row.last_status_event
                  ? <div><div>{t(actorKey(row.last_status_event.actor_type))}</div><div className="text-xs text-muted-foreground">{formatDate(row.last_status_event.created_at, i18n.language, "datetime")}</div></div>
                  : <span className="text-muted-foreground">—</span>}
              </td>
              <td className={`${td} num text-xs`}>{formatDate(row.last_seen_at, i18n.language, "datetime")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
