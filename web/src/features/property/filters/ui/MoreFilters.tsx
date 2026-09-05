import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { renovationKey } from "@/shared/i18n";
import { cn } from "@/shared/lib";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import {
  $advancedCount, $areaMax, $areaMin, $floorMax, $floorMin, $furnished, $postedWithin, $renovation,
  advancedReset, areaChanged, floorChanged, furnishedChanged, postedWithinChanged, renovationToggled,
} from "../model";

/** Static — not backend-driven meta like districts — so the kinds the UI offers are fixed here. */
const RENOVATIONS = ["euro", "designer", "cosmetic", "average", "needs_repair", "other"] as const;
const POSTED_WITHIN_OPTS = ["24h", "3d", "7d"] as const;

const chip = (on: boolean) =>
  cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium", on ? "border-primary bg-primary text-white" : "border-input bg-surface");

const has = (csv: string, key: string) => csv.split(",").includes(key);

/**
 * The rail's overflow: filters niche enough to hide behind a dialog rather than take up a
 * permanent section. District/rooms/price/status/buildingType/conditions all now live directly
 * in the rail (see `../ui.tsx`); this dialog keeps the rest — area, floor range, furnished,
 * renovation and posted-within.
 */
export function MoreFilters({ className }: { className?: string } = {}) {
  const { t } = useTranslation();
  const [areaMin, areaMax, floorMin, floorMax, furnished, renovation, postedWithin, count] = useUnit([
    $areaMin, $areaMax, $floorMin, $floorMax, $furnished, $renovation, $postedWithin, $advancedCount,
  ]);
  const [onArea, onFloor, onFurnished, onRenovation, onPostedWithin, onReset] = useUnit([
    areaChanged, floorChanged, furnishedChanged, renovationToggled, postedWithinChanged, advancedReset,
  ]);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm" className={className} aria-label={count > 0 ? t("properties.filters.moreCount", { count }) : t("properties.filters.more")}>
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

          <Button type="button" variant="ghost" size="sm" onClick={() => onReset()}>{t("properties.filters.resetAdvanced")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
