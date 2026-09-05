import { Calendar, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PropertyDetail } from "@/entities/property";
import { districtKey, renovationKey } from "@/shared/i18n";
import { LocationCard } from "./LocationCard";
import { PhotoGallery } from "./PhotoGallery";
import { SpecGrid } from "./SpecGrid";
import { formatDate } from "@/shared/lib";

/** The newest `posted_at` across every listing of the property, or null when none carry one. */
function newestPostedAt(detail: PropertyDetail): string | null {
  return detail.listings.reduce<string | null>((newest, l) => {
    if (!l.posted_at) return newest;
    return !newest || new Date(l.posted_at).getTime() > new Date(newest).getTime() ? l.posted_at : newest;
  }, null);
}

/**
 * The main column: gallery, an OLX-style title (an accepted price card lives in the sticky
 * sidebar instead — see PropertySidebar), the characteristics grid, description and location.
 */
export function PropertyHeader({ detail }: { detail: PropertyDetail }) {
  const { t, i18n } = useTranslation();
  // the API already prefixes every photo URL (/api/v1/photos/<listing>/<n>.jpg)
  const photos = detail.listings.flatMap((l) => l.photos);
  const description = detail.listings[0]?.description?.trim();
  const postedAt = newestPostedAt(detail);
  const location = detail.location_label ?? (detail.district ? t(districtKey(detail.district)) : null);

  // "3-xonali, 54 m², Evroremont — Chilonzor": whichever of rooms/area/renovation/district the
  // property actually has (any of them can be null) joined into one OLX-style sentence.
  const titleParts = [
    detail.rooms != null ? t("properties.rooms", { count: detail.rooms }) : null,
    detail.area_sqm != null ? t("properties.area", { area: Math.round(detail.area_sqm) }) : null,
    detail.renovation != null ? t(renovationKey(detail.renovation)) : null,
  ].filter((p): p is string => p != null);
  const district = detail.district ? t(districtKey(detail.district)) : null;
  const title = [titleParts.join(", "), district].filter(Boolean).join(" — ") || t("property.back");

  return (
    <div className="flex flex-col gap-3">
      <PhotoGallery photos={photos} alt={t("property.photoAlt")} />

      <div className="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-3.5">
        <h2 className="text-balance text-lg font-bold tracking-tight">{title}</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{location}</span>}
          {postedAt && <span className="inline-flex items-center gap-1"><Calendar className="size-3.5" />{t("property.postedAt")}: {formatDate(postedAt, i18n.language)}</span>}
          <span className="num">#{detail.id.slice(0, 8)}</span>
        </div>
      </div>

      <SpecGrid detail={detail} />

      {description && (
        <div className="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-3.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("property.description")}</span>
          <p className="whitespace-pre-line text-sm">{description}</p>
        </div>
      )}

      <LocationCard detail={detail} />
    </div>
  );
}
