import { useTranslation } from "react-i18next";
import { PropertyTitle, type PropertyDetail } from "@/entities/property";
import { formatUsdFromMinor } from "@/shared/lib";

export function PropertyHeader({ detail }: { detail: PropertyDetail }) {
  const { t } = useTranslation();
  // the API already prefixes every photo URL (/api/v1/photos/<listing>/<n>.jpg)
  const photos = detail.listings.flatMap((l) => l.photos);
  const [first, second, ...rest] = photos;
  return (
    <div className="flex flex-col gap-3">
      {first ? (
        <div className="grid grid-cols-[2fr_1fr] grid-rows-[96px_96px] gap-1.5 lg:grid-rows-[160px_160px]">
          <img src={first.url} alt={t("property.photoAlt")} className="row-span-2 size-full rounded-lg object-cover" />
          {/* supplementary — the first photo already carries the meaningful alt text */}
          {second ? <img src={second.url} alt="" className="size-full rounded-lg object-cover" /> : <div className="rounded-lg bg-[#d8e2df]" />}
          <div className="flex items-center justify-center rounded-lg bg-[#d8e2df] text-sm font-semibold text-[#3f4d49]">{rest.length > 0 ? `+${rest.length}` : t("property.photos", { count: photos.length })}</div>
        </div>
      ) : <div className="flex h-24 items-center justify-center rounded-lg bg-[#d8e2df] text-xs text-[#6b7c77]">{t("property.noPhotos")}</div>}
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
