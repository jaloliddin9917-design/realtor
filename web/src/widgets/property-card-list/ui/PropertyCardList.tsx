import { Link } from "atomic-router-react";
import { useUnit } from "effector-react";
import { Camera, ImageOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { $meta } from "@/entities/meta";
import { OwnerBadge, PropertyTitle, StatusPill, type PropertyRow } from "@/entities/property";
import { kindKey } from "@/shared/i18n";
import { cn, formatDate, formatMoney, formatUsdFromMinor } from "@/shared/lib";
import { routes } from "@/shared/router";

/** Small bold status-style pill — mirrors `StatusPill`'s own recipe (that component only
 * accepts a `PropertyStatus`, so the recheck/removed flags here get a local copy). */
const pill = (className: string) => cn("inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-bold leading-none", className);

/**
 * The OLX-style card grid — the sole rendering of the properties list now, at every width
 * (see `pages/properties`; `PropertyTable`'s dense columns are retired). `className` lets a
 * caller override the responsive column count — used by the map view's narrower cards column,
 * which stays single-column regardless of viewport width.
 */
export function PropertyCardList({ rows, className }: { rows: PropertyRow[]; className?: string }) {
  const { t, i18n } = useTranslation();
  const fx = useUnit($meta)?.fx ?? null;
  return (
    <div className={cn("grid gap-4", className ?? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3")}>
      {rows.map((row) => {
        const source = row.source_kinds[0];
        const approxUzs = fx && row.price_usd_min_minor !== null
          ? t("call.approxSum", { amount: formatMoney(row.price_usd_min_minor * Number(fx.usd_uzs), "UZS", i18n.language) })
          : null;
        return (
          <Link
            key={row.id}
            to={routes.property}
            params={{ id: row.id }}
            className="flex flex-col overflow-hidden rounded-card border border-line bg-surface text-ink transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
          >
            <div className="relative aspect-[4/3] bg-surface-soft">
              {row.photo_url
                ? <img src={row.photo_url} alt="" className="size-full object-cover" />
                : <div className="flex size-full items-center justify-center text-muted-foreground"><ImageOff className="size-8" aria-hidden="true" /></div>}
              {/* purely decorative legibility gradient for the overlaid chips below */}
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/15 via-transparent to-black/15" />
              {source && <span className="absolute bottom-2 left-2 rounded bg-surface/90 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-ink">{t(kindKey(source))}</span>}
              {/* decorative "has a photo" affordance — real photo *counts* aren't in PropertyRow, so
                  this is presence-only, unlike the mockup's fake per-card number */}
              {row.photo_url && <span aria-hidden="true" className="absolute bottom-2 right-2 rounded-full bg-ink/70 p-1.5 text-white"><Camera className="size-3.5" /></span>}
            </div>
            <div className="flex flex-1 flex-col gap-1.5 p-3">
              <div className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="num text-xl font-extrabold tracking-tight text-price">{formatUsdFromMinor(row.price_usd_min_minor)}</span>
                <span className="text-xs font-semibold text-muted-foreground">{t("property.perMonth")}</span>
                {approxUzs && <span className="num ml-auto text-xs font-medium text-muted-foreground">{approxUzs}</span>}
              </div>
              <PropertyTitle row={row} />
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                {/* district is already the PropertyTitle heading above; only show this line's
                    location half when there is a *more specific* label, rather than repeating it */}
                {row.location_label ? <span className="min-w-0 truncate">{row.location_label}</span> : <span />}
                <span className="num flex-none">{formatDate(row.last_seen_at, i18n.language, "datetime")}</span>
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                <StatusPill status={row.status} />
                {row.needs_recheck && <span className={pill("bg-bg text-muted-foreground")}>{t("properties.needsRecheck")}</span>}
                {row.source_removed && <span className={pill("bg-status-new-bg text-status-new")}>{t("properties.removedBadge")}</span>}
              </div>
              <OwnerBadge owner={row.probable_owner} />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
