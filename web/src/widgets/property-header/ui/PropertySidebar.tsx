import { useState } from "react";
import { Link } from "atomic-router-react";
import { useUnit } from "effector-react";
import { AlertTriangle, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { $meta } from "@/entities/meta";
import { OwnerBadge, StatusPill, type PropertyDetail } from "@/entities/property";
import { StatusButtons } from "@/features/property/set-status";
import { kindKey } from "@/shared/i18n";
import { cn, formatDate, formatMoney, formatPhone, formatUsdFromMinor } from "@/shared/lib";
import { routes } from "@/shared/router";
import { Button, buttonVariants } from "@/shared/ui/button";

/** "+998908112437" -> "+998 90 ••• •• 37". Display-only theatre: the API already hands us the
 * real number (there is no partially-redacted wire format) — "reveal" is a click, not a fetch. */
function maskPhone(identifier: string): string {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(identifier);
  return m ? `+998 ${m[1]} ••• •• ${m[4]}` : identifier;
}

/** The probable owner's number, or — failing that — the first contact off any listing. Null
 * when the property has neither, which keeps the contact row masked forever (nothing to reveal). */
function resolvePhone(detail: PropertyDetail): string | null {
  return detail.probable_owner?.identifier ?? detail.listings.flatMap((l) => l.contacts)[0]?.identifier ?? null;
}

/** Whole days between an ISO timestamp and now — mirrors dashboard's RecheckCard, computed
 * locally since PropertyDetail carries no precomputed day count for its own last confirmation. */
function daysAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/**
 * The sticky right column: price + status/owner, a probable-owner contact card with a
 * show-phone reveal, the CRM actions (status buttons + a take-and-call primary), a meta list,
 * and — when the property needs it — a recheck prompt pointing back at the queue.
 */
export function PropertySidebar({ detail, className }: { detail: PropertyDetail; className?: string }) {
  const { t, i18n } = useTranslation();
  const meta = useUnit($meta);
  const [revealed, setRevealed] = useState(false);
  const phone = resolvePhone(detail);
  const fx = meta?.fx ?? null;
  const confirmedAt = detail.last_status_event?.created_at ?? detail.last_seen_at;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-sm">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <span className="num text-[28px] font-extrabold tracking-tight text-price">{formatUsdFromMinor(detail.price_usd_min_minor)}</span>
            <span className="text-sm font-semibold text-muted-foreground">{t("property.perMonth")}</span>
          </div>
          {fx && detail.price_usd_min_minor != null && (
            <span className="num text-sm text-muted-foreground">
              {t("call.approxSum", { amount: formatMoney(detail.price_usd_min_minor * Number(fx.usd_uzs), "UZS", i18n.language) })}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={detail.status} />
          <OwnerBadge owner={detail.probable_owner} />
        </div>

        <div className="flex items-center gap-3 border-y border-line-soft py-3">
          <div className="flex size-11 flex-none items-center justify-center rounded-full bg-owner-bg text-owner">
            {detail.probable_owner?.display_name?.trim()
              ? <span className="text-base font-extrabold">{detail.probable_owner.display_name.trim()[0]!.toUpperCase()}</span>
              : <Phone className="size-5" />}
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="text-xs font-semibold text-muted-foreground">{t("property.owner")}</span>
            <span className="num truncate font-mono text-base font-extrabold">
              {phone ? (revealed ? formatPhone(phone) : maskPhone(phone)) : t("property.noOwner")}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {revealed && phone ? (
            <Button asChild size="lg">
              <a href={`tel:${phone}`}><Phone className="size-4" />{t("properties.callNow")}</a>
            </Button>
          ) : (
            <Button type="button" size="lg" disabled={!phone} onClick={() => setRevealed(true)}>
              <Phone className="size-4" />{t("properties.showPhone")}
            </Button>
          )}

          <StatusButtons property={detail} />
        </div>

        <div className="flex flex-col gap-1.5 border-t border-line-soft pt-3 text-[13px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{t("properties.filters.source")}</span>
            <span className="font-semibold">{detail.source_kinds.map((k) => t(kindKey(k))).join(" · ")}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{t("properties.sort.first_seen")}</span>
            <span className="num font-semibold">{formatDate(detail.first_seen_at, i18n.language)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{t("properties.columns.listings")}</span>
            <span className="num font-semibold">{detail.listing_count} · {detail.source_kinds.map((k) => t(kindKey(k))).join(" · ")}</span>
          </div>
        </div>
      </div>

      {detail.needs_recheck && (
        <div className="flex flex-col gap-2.5 rounded-card border border-warn-line bg-warn-bg p-3.5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-[18px] flex-none text-warn" />
            <p className="text-[13px] leading-snug text-warn">
              <b>{t("dashboard.recheck.title")}.</b> {t("dashboard.recheck.confirmedAgo", { days: daysAgo(confirmedAt) })}.
            </p>
          </div>
          <Link to={routes.queue} className={buttonVariants({ variant: "outline", size: "sm" })}>{t("dashboard.recheck.action")}</Link>
        </div>
      )}
    </div>
  );
}
