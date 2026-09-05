import { useTranslation } from "react-i18next";
import { PropertyTitle, type PropertyDetail } from "@/entities/property";
import { LocationCard } from "./LocationCard";
import { PhotoGallery } from "./PhotoGallery";
import { SpecGrid } from "./SpecGrid";
import { formatDate, formatUsdFromMinor } from "@/shared/lib";

/** The newest `posted_at` across every listing of the property, or null when none carry one. */
function newestPostedAt(detail: PropertyDetail): string | null {
  return detail.listings.reduce<string | null>((newest, l) => {
    if (!l.posted_at) return newest;
    return !newest || new Date(l.posted_at).getTime() > new Date(newest).getTime() ? l.posted_at : newest;
  }, null);
}

export function PropertyHeader({ detail }: { detail: PropertyDetail }) {
  const { t, i18n } = useTranslation();
  // the API already prefixes every photo URL (/api/v1/photos/<listing>/<n>.jpg)
  const photos = detail.listings.flatMap((l) => l.photos);
  const description = detail.listings[0]?.description?.trim();
  const postedAt = newestPostedAt(detail);
  return (
    <div className="flex flex-col gap-3">
      <PhotoGallery photos={photos} alt={t("property.photoAlt")} />
      <div className="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-3.5">
        <div className="flex items-baseline gap-1.5">
          <span className="num text-[22px] font-bold">{formatUsdFromMinor(detail.price_usd_min_minor)}</span>
          <span className="text-xs text-muted-foreground">{t("property.perMonth")}</span>
        </div>
        {/* PropertyTitle is the district plus the attributes line (rooms · floor · area) */}
        <PropertyTitle row={detail} />
      </div>
      <SpecGrid detail={detail} />
      {description && (
        <div className="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-3.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("property.description")}</span>
          <p className="whitespace-pre-line text-sm">{description}</p>
        </div>
      )}
      {postedAt && <span className="text-xs text-muted-foreground">{t("property.postedAt")}: {formatDate(postedAt, i18n.language)}</span>}
      <LocationCard detail={detail} />
    </div>
  );
}
