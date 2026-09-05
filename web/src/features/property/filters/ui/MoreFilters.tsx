import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { buildingTypeKey, renovationKey } from "@/shared/i18n";
import { cn } from "@/shared/lib";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Switch } from "@/shared/ui/switch";
import {
  $advancedCount, $areaMax, $areaMin, $buildingType, $floorMax, $floorMin, $furnished, $hasPhotos, $notFirstFloor, $notTopFloor, $postedWithin, $renovation,
  advancedReset, areaChanged, buildingTypeToggled, floorChanged, furnishedChanged, hasPhotosToggled, notFirstFloorToggled, notTopFloorToggled, postedWithinChanged, renovationToggled,
} from "../model";

/** Static — not backend-driven meta like districts — so the four kinds the UI offers are fixed here. */
const BUILDING_TYPES = ["brick", "panel", "monolith", "block"] as const;
const RENOVATIONS = ["euro", "designer", "cosmetic", "average", "needs_repair", "other"] as const;
const POSTED_WITHIN_OPTS = ["24h", "3d", "7d"] as const;

const chip = (on: boolean) =>
  cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium", on ? "border-primary bg-primary text-white" : "border-input bg-surface");

const has = (csv: string, key: string) => csv.split(",").includes(key);

/** The primary bar's overflow: filters niche enough to hide behind a dialog rather than
 * compete for space with district/rooms/price/status on every screen size. */
export function MoreFilters() {
  const { t } = useTranslation();
  const [areaMin, areaMax, floorMin, floorMax, notFirstFloor, notTopFloor, buildingType, furnished, renovation, postedWithin, hasPhotos, count] = useUnit([
    $areaMin, $areaMax, $floorMin, $floorMax, $notFirstFloor, $notTopFloor, $buildingType, $furnished, $renovation, $postedWithin, $hasPhotos, $advancedCount,
  ]);
  const [onArea, onFloor, onNotFirst, onNotTop, onBuildingType, onFurnished, onRenovation, onPostedWithin, onHasPhotos, onReset] = useUnit([
    areaChanged, floorChanged, notFirstFloorToggled, notTopFloorToggled, buildingTypeToggled, furnishedChanged, renovationToggled, postedWithinChanged, hasPhotosToggled, advancedReset,
  ]);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" aria-label={count > 0 ? t("properties.filters.moreCount", { count }) : t("properties.filters.more")}>
          {t("properties.filters.more")}
          {count > 0 && <Badge variant="secondary">{count}</Badge>}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t("properties.filters.more")}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>{t("properties.filters.area")}</Label>
            <div className="flex items-center gap-2">
              <Input className="w-24" inputMode="numeric" placeholder={t("properties.filters.areaMin")} value={areaMin} onChange={(e) => onArea({ min: e.target.value, max: areaMax })} aria-label={t("properties.filters.areaMin")} />
              <Input className="w-24" inputMode="numeric" placeholder={t("properties.filters.areaMax")} value={areaMax} onChange={(e) => onArea({ min: areaMin, max: e.target.value })} aria-label={t("properties.filters.areaMax")} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Input className="w-24" inputMode="numeric" placeholder={t("properties.filters.floorMin")} value={floorMin} onChange={(e) => onFloor({ min: e.target.value, max: floorMax })} aria-label={t("properties.filters.floorMin")} />
              <Input className="w-24" inputMode="numeric" placeholder={t("properties.filters.floorMax")} value={floorMax} onChange={(e) => onFloor({ min: floorMin, max: e.target.value })} aria-label={t("properties.filters.floorMax")} />
            </div>
            <label className="flex items-center gap-2 text-[13px]"><Switch checked={notFirstFloor === "1"} onCheckedChange={() => onNotFirst()} />{t("properties.filters.notFirstFloor")}</label>
            <label className="flex items-center gap-2 text-[13px]"><Switch checked={notTopFloor === "1"} onCheckedChange={() => onNotTop()} />{t("properties.filters.notTopFloor")}</label>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("properties.filters.buildingType")}</Label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("properties.filters.buildingType")}>
              {BUILDING_TYPES.map((b) => (
                <button key={b} type="button" className={chip(has(buildingType, b))} aria-pressed={has(buildingType, b)} onClick={() => onBuildingType(b)}>{t(buildingTypeKey(b))}</button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="furnished">{t("properties.filters.furnished")}</Label>
            <Select value={furnished || "any"} onValueChange={(v) => onFurnished(v === "any" ? "" : v)}>
              <SelectTrigger id="furnished" className="h-8 w-full" aria-label={t("properties.filters.furnished")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">{t("properties.filters.all")}</SelectItem>
                <SelectItem value="1">{t("property.yes")}</SelectItem>
                <SelectItem value="0">{t("property.no")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("properties.filters.renovation")}</Label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("properties.filters.renovation")}>
              {RENOVATIONS.map((r) => (
                <button key={r} type="button" className={chip(has(renovation, r))} aria-pressed={has(renovation, r)} onClick={() => onRenovation(r)}>{t(renovationKey(r))}</button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="posted-within">{t("properties.filters.postedWithin")}</Label>
            <Select value={postedWithin || "any"} onValueChange={(v) => onPostedWithin(v === "any" ? "" : v)}>
              <SelectTrigger id="posted-within" className="h-8 w-full" aria-label={t("properties.filters.postedWithin")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">{t("properties.filters.all")}</SelectItem>
                {POSTED_WITHIN_OPTS.map((p) => <SelectItem key={p} value={p}>{t(`properties.filters.postedWithinOpts.${p}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2 text-[13px]"><Switch checked={hasPhotos === "1"} onCheckedChange={() => onHasPhotos()} />{t("properties.filters.hasPhotos")}</label>

          <Button variant="ghost" size="sm" onClick={() => onReset()}>{t("properties.filters.resetAdvanced")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
