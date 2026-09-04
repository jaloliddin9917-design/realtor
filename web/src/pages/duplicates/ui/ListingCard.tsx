import { Image as ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Classification, DuplicateListingSide } from "@/entities/duplicate";
import { classificationKey } from "@/shared/i18n";
import { cn, formatDate, formatPhone, formatUsdFromMinor } from "@/shared/lib";

const CLASSIFICATION_STYLES: Record<Classification, string> = {
  owner: "bg-owner-bg text-owner",
  agent: "bg-agent-bg text-agent",
  unknown: "bg-status-new-bg text-status-new",
};

/** At most this many thumbnails render before the rest collapse into one "+N" tile. */
const PHOTO_LIMIT = 3;

export function ListingCard({ label, listing }: { label: "A" | "B"; listing: DuplicateListingSide }) {
  const { t, i18n } = useTranslation();
  const shown = listing.photos.slice(0, PHOTO_LIMIT);
  const overflow = listing.photos.length - shown.length;
  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{label} · {listing.sourceLabel}</span>
        <span className="text-xs text-muted-foreground">{formatDate(listing.postedAt, i18n.language)}</span>
      </div>
      {shown.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {shown.map((url, i) => (
            <img key={url} src={url} alt={t("duplicates.photo.label", { n: i + 1 })} className="aspect-square w-full rounded-lg bg-surface-soft object-cover" />
          ))}
          {overflow > 0 && (
            <div className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg bg-surface-soft text-center">
              <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
              <span className="text-[11px] text-muted-foreground">{t("duplicates.photo.more", { count: overflow })}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-16 items-center justify-center rounded-lg bg-surface-soft">
          <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
        </div>
      )}
      <div className="text-sm font-medium">{listing.title}</div>
      <div className="text-sm">
        <span className="num font-semibold">{formatUsdFromMinor(listing.priceUsdMinor)}</span> · {t("properties.rooms", { count: listing.rooms })} · {listing.floor}/{listing.totalFloors} · {t("properties.area", { area: listing.areaSqm })}
      </div>
      <p className="text-xs text-muted-foreground">{listing.description}</p>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2.5">
        <span className="num font-mono text-sm">{listing.phone ? formatPhone(listing.phone) : "—"}</span>
        <span className={cn("inline-flex h-5 w-fit items-center rounded-full px-2 text-xs font-semibold", CLASSIFICATION_STYLES[listing.classification])}>
          {t(classificationKey(listing.classification))}
          {listing.homesCount !== undefined && <> · {t("duplicates.contact.homesCount", { count: listing.homesCount })}</>}
        </span>
      </div>
    </div>
  );
}
