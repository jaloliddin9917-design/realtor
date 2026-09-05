import { useUnit } from "effector-react";
import { LayoutGrid, Map as MapIcon, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { $districts } from "@/entities/meta";
import { $total } from "@/entities/property";
import { buildingTypeKey, districtKey, kindKey, statusKey } from "@/shared/i18n";
import { cn } from "@/shared/lib";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Switch } from "@/shared/ui/switch";
import {
  $buildingType, $district, $hasPhotos, $notFirstFloor, $notTopFloor, $ownerOnly, $page, $pageCount, $priceMax, $priceMin, $q, $removed, $rooms, $sort, $source, $status, $view,
  buildingTypeToggled, districtToggled, filtersCleared, hasPhotosToggled, notFirstFloorToggled, notTopFloorToggled, ownerOnlyToggled, pageChanged, priceChanged, removedToggled, roomsToggled, searchChanged, sortChanged, sourceChanged, statusChanged, viewChanged,
} from "./model";
import { MoreFilters } from "./ui/MoreFilters";

/** Static — not backend-driven meta like districts — so the four kinds the UI offers are fixed here. */
const BUILDING_TYPES = ["brick", "panel", "monolith", "block"] as const;

const chip = (on: boolean) =>
  cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium", on ? "border-primary bg-primary text-white" : "border-input bg-surface");

const has = (csv: string, key: string) => csv.split(",").includes(key);

/** One bordered, labeled block of the filter rail — mirrors the mockup's `.fgroup`. Sections are
 * separated by a hairline; the last one in the rail passes `className="border-b-0"`. */
function FilterSection({ label, className, children }: { label?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("border-b border-line-soft p-4", className)}>
      {label && <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>}
      {children}
    </div>
  );
}

/**
 * The left filter rail (OLX mockup's `.rail`). Every field still reads/writes the same
 * `features/property/filters/model` stores/events as before — only the layout changed: a
 * bordered card with labeled sections instead of one wrapped horizontal bar. `buildingType` and
 * four of the toggle switches (previously only reachable via `MoreFilters`) are promoted to
 * permanent sections here, matching the mockup's "Тип дома" / "Условия" groups; `MoreFilters`
 * keeps the rest (area, floor range, furnished, renovation, posted-within).
 */
export function FilterBar() {
  const { t } = useTranslation();
  const [districts, district, rooms, priceMin, priceMax, status, source, ownerOnly, removed, q, buildingType, notFirstFloor, notTopFloor, hasPhotos, total] = useUnit([
    $districts, $district, $rooms, $priceMin, $priceMax, $status, $source, $ownerOnly, $removed, $q, $buildingType, $notFirstFloor, $notTopFloor, $hasPhotos, $total,
  ]);
  const [onDistrict, onRooms, onPrice, onStatus, onSource, onOwner, onRemoved, onSearch, onClear, onBuildingType, onNotFirst, onNotTop, onHasPhotos] = useUnit([
    districtToggled, roomsToggled, priceChanged, statusChanged, sourceChanged, ownerOnlyToggled, removedToggled, searchChanged, filtersCleared, buildingTypeToggled, notFirstFloorToggled, notTopFloorToggled, hasPhotosToggled,
  ]);
  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-3">
        <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden="true" />
        <Button type="button" variant="ghost" size="sm" onClick={() => onClear()}>{t("properties.filters.clear")}</Button>
      </div>

      <FilterSection>
        <Input placeholder={t("properties.filters.search")} value={q} onChange={(e) => onSearch(e.target.value)} aria-label={t("properties.filters.search")} maxLength={200} />
      </FilterSection>

      <FilterSection label={t("properties.filters.district")}>
        <div className="flex flex-col gap-2" role="group" aria-label={t("properties.filters.district")}>
          {districts.map((d) => (
            <label key={d} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={has(district, d)} onCheckedChange={() => onDistrict(d)} />
              {t(districtKey(d))}
            </label>
          ))}
        </div>
      </FilterSection>

      <FilterSection label={t("properties.filters.price")}>
        <div className="flex items-center gap-2">
          <Input inputMode="numeric" placeholder={t("properties.filters.priceMin")} value={priceMin} onChange={(e) => onPrice({ min: e.target.value, max: priceMax })} aria-label={t("properties.filters.priceMin")} />
          <Input inputMode="numeric" placeholder={t("properties.filters.priceMax")} value={priceMax} onChange={(e) => onPrice({ min: priceMin, max: e.target.value })} aria-label={t("properties.filters.priceMax")} />
        </div>
      </FilterSection>

      <FilterSection label={t("properties.filters.rooms")}>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("properties.filters.rooms")}>
          {(["1", "2", "3", "4"] as const).map((r) => (
            <button key={r} type="button" className={chip(has(rooms, r))} aria-pressed={has(rooms, r)} onClick={() => onRooms(r)}>{r === "4" ? t("properties.filters.roomsPlus") : r}</button>
          ))}
        </div>
      </FilterSection>

      <FilterSection label={t("properties.filters.buildingType")}>
        <div className="flex flex-col gap-2" role="group" aria-label={t("properties.filters.buildingType")}>
          {BUILDING_TYPES.map((b) => (
            <label key={b} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={has(buildingType, b)} onCheckedChange={() => onBuildingType(b)} />
              {t(buildingTypeKey(b))}
            </label>
          ))}
        </div>
      </FilterSection>

      <FilterSection label={t("properties.filters.source")}>
        <Select value={source || "all"} onValueChange={(v) => onSource(v === "all" ? "" : v)}>
          <SelectTrigger className="h-9 w-full" aria-label={t("properties.filters.source")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("properties.filters.source")}: {t("properties.filters.all")}</SelectItem>
            {(["olx", "telegram", "manual"] as const).map((k) => <SelectItem key={k} value={k}>{t(kindKey(k))}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterSection>

      {/* "Условия" — no dedicated i18n key for this section title exists in the catalogue, so it
          reuses `call.conditions.title` ("Условия (необязательно)"), the same word from the
          call-outcome screen's own conditions group. */}
      <FilterSection label={t("call.conditions.title")}>
        <div className="flex flex-col gap-2.5">
          <label className="flex items-center justify-between gap-2 text-sm"><span>{t("properties.filters.ownerOnly")}</span><Switch checked={ownerOnly === "1"} onCheckedChange={() => onOwner()} /></label>
          <label className="flex items-center justify-between gap-2 text-sm"><span>{t("properties.filters.notFirstFloor")}</span><Switch checked={notFirstFloor === "1"} onCheckedChange={() => onNotFirst()} /></label>
          <label className="flex items-center justify-between gap-2 text-sm"><span>{t("properties.filters.notTopFloor")}</span><Switch checked={notTopFloor === "1"} onCheckedChange={() => onNotTop()} /></label>
          <label className="flex items-center justify-between gap-2 text-sm"><span>{t("properties.filters.hasPhotos")}</span><Switch checked={hasPhotos === "1"} onCheckedChange={() => onHasPhotos()} /></label>
          <label className="flex items-center justify-between gap-2 text-sm"><span>{t("properties.filters.removed")}</span><Switch checked={removed === "1"} onCheckedChange={() => onRemoved()} /></label>
        </div>
      </FilterSection>

      <FilterSection label={t("properties.filters.status")} className="border-b-0">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("properties.filters.status")}>
          {(["new", "active", "inactive"] as const).map((s) => (
            <button key={s} type="button" className={chip(has(status, s))} aria-pressed={has(status, s)} onClick={() => onStatus(s)}>{t(statusKey(s))}</button>
          ))}
        </div>
      </FilterSection>

      <div className="flex flex-col gap-2 p-4">
        <MoreFilters className="w-full justify-center" />
        {/* Filters already apply live (debounced in ./model), so this isn't a real submit — it
            jumps to the results column, which matters most on mobile where the rail (see
            pages/properties/ui.tsx) stacks above it. Reuses `properties.count` rather than
            inventing "Показать …" copy, since no such key exists in the catalogue. */}
        <Button type="button" className="w-full" onClick={() => document.getElementById("properties-results")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
          {t("properties.count", { count: total })}
        </Button>
      </div>
    </div>
  );
}

export function ResultsBar() {
  const { t } = useTranslation();
  const [total, sort, view] = useUnit([$total, $sort, $view]);
  const [onSort, onViewChanged] = useUnit([sortChanged, viewChanged]);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <b className="text-lg font-extrabold tracking-tight">{t("properties.count", { count: total })}</b>
      <div className="ml-auto flex items-center gap-2">
        <Select value={sort || "last_seen"} onValueChange={onSort}>
          <SelectTrigger className="h-9 w-44" aria-label={t("properties.filters.sort")}><SelectValue /></SelectTrigger>
          <SelectContent>{(["last_seen", "first_seen", "price_asc", "price_desc"] as const).map((s) => <SelectItem key={s} value={s}>{t(`properties.sort.${s}`)}</SelectItem>)}</SelectContent>
        </Select>
        {/* no group-level aria-label: there is no dedicated "view mode" i18n key, and each
            button's own aria-label ("List"/"Map") is already a clear accessible name on its own */}
        <div className="flex items-center gap-0.5 rounded-md border border-line bg-surface p-0.5" role="group">
          <button type="button" aria-label={t("properties.map.list")} aria-pressed={view === "list"} className={cn("inline-flex size-8 items-center justify-center rounded text-muted-foreground", view === "list" ? "bg-accent text-accent-foreground" : "hover:bg-accent/50")} onClick={() => onViewChanged("list")}><LayoutGrid className="size-4" /></button>
          <button type="button" aria-label={t("properties.map.map")} aria-pressed={view === "map"} className={cn("inline-flex size-8 items-center justify-center rounded text-muted-foreground", view === "map" ? "bg-accent text-accent-foreground" : "hover:bg-accent/50")} onClick={() => onViewChanged("map")}><MapIcon className="size-4" /></button>
        </div>
      </div>
    </div>
  );
}

export function Pagination() {
  const { t } = useTranslation();
  const [page, pages, onPage] = useUnit([$page, $pageCount, pageChanged]);
  const current = Number(page) || 1;
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 pt-2 text-[13px]">
      <Button variant="outline" size="sm" className="border-primary text-primary hover:bg-accent hover:text-accent-foreground" disabled={current <= 1} onClick={() => onPage(current - 1)}>{t("properties.prev")}</Button>
      <span className="num text-muted-foreground">{t("properties.page", { page: current, pages })}</span>
      <Button variant="outline" size="sm" className="border-primary text-primary hover:bg-accent hover:text-accent-foreground" disabled={current >= pages} onClick={() => onPage(current + 1)}>{t("properties.next")}</Button>
    </div>
  );
}
