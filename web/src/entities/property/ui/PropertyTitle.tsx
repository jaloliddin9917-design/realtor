import { useTranslation } from "react-i18next";
import { districtKey } from "@/shared/i18n";
import type { PropertyRow } from "../api";

export function PropertyTitle({ row }: { row: Pick<PropertyRow, "district" | "rooms" | "floor" | "total_floors" | "area_sqm"> }) {
  const { t } = useTranslation();
  const parts = [
    row.rooms !== null ? t("properties.rooms", { count: row.rooms }) : null,
    row.floor !== null && row.total_floors !== null ? t("properties.floor", { floor: row.floor, total: row.total_floors }) : null,
    row.area_sqm !== null ? t("properties.area", { area: Math.round(row.area_sqm) }) : null,
  ].filter(Boolean);
  return (
    <div>
      <div className="font-semibold">{row.district ? t(districtKey(row.district)) : "—"}</div>
      <div className="text-xs text-muted-foreground">{parts.join(" · ")}</div>
    </div>
  );
}
