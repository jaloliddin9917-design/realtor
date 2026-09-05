import { useTranslation } from "react-i18next";
import type { PropertyDetail } from "@/entities/property";
import { bathroomTypeKey, buildingTypeKey, renovationKey } from "@/shared/i18n";

/** `attributes` is a loose `{[key: string]: unknown}` bag — narrow the one field we read. */
function bathroomTypeOf(listing: PropertyDetail["listings"][number] | undefined): string | null {
  const value = listing?.attributes?.["bathroom_type"];
  return typeof value === "string" ? value : null;
}

/**
 * A small label -> value spec sheet: building type, furnished, renovation, year built, and the
 * primary listing's bathroom type, plus the pre-existing floor/total and area. Each cell is
 * omitted when its value is null (most apartments only have some of these), and the whole card
 * disappears when every cell would be empty.
 */
export function SpecGrid({ detail }: { detail: PropertyDetail }) {
  const { t } = useTranslation();
  const bathroomType = bathroomTypeOf(detail.listings[0]);

  const cells: { key: string; label: string; value: string }[] = [];
  if (detail.building_type != null) cells.push({ key: "buildingType", label: t("property.spec.buildingType"), value: t(buildingTypeKey(detail.building_type)) });
  if (detail.is_furnished != null) cells.push({ key: "furnished", label: t("property.spec.furnished"), value: t(detail.is_furnished ? "property.yes" : "property.no") });
  if (detail.renovation != null) cells.push({ key: "renovation", label: t("property.spec.renovation"), value: t(renovationKey(detail.renovation)) });
  if (detail.year_built != null) cells.push({ key: "yearBuilt", label: t("property.spec.yearBuilt"), value: String(detail.year_built) });
  if (bathroomType != null) cells.push({ key: "bathroom", label: t("property.spec.bathroom"), value: t(bathroomTypeKey(bathroomType)) });
  if (detail.floor != null && detail.total_floors != null) cells.push({ key: "floor", label: t("property.attrs.floor"), value: `${detail.floor}/${detail.total_floors}` });
  if (detail.area_sqm != null) cells.push({ key: "area", label: t("property.attrs.area"), value: t("properties.area", { area: Math.round(detail.area_sqm) }) });

  if (cells.length === 0) return null;

  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-3.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("property.specs")}</span>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
        {cells.map((c) => (
          <div key={c.key} className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground">{c.label}</span>
            <span className="text-sm font-medium">{c.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
