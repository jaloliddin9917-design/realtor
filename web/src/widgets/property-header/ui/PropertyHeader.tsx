import { useTranslation } from "react-i18next";
import { PropertyTitle, type PropertyDetail } from "@/entities/property";
import { PhotoGallery } from "./PhotoGallery";
import { formatUsdFromMinor } from "@/shared/lib";

export function PropertyHeader({ detail }: { detail: PropertyDetail }) {
  const { t } = useTranslation();
  // the API already prefixes every photo URL (/api/v1/photos/<listing>/<n>.jpg)
  const photos = detail.listings.flatMap((l) => l.photos);
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
    </div>
  );
}
