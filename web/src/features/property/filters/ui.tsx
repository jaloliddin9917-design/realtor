import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $districts } from "@/entities/meta";
import { $total } from "@/entities/property";
import { districtKey, kindKey, statusKey } from "@/shared/i18n";
import { cn } from "@/shared/lib";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Switch } from "@/shared/ui/switch";
import { $district, $ownerOnly, $page, $pageCount, $priceMax, $priceMin, $q, $removed, $rooms, $sort, $source, $status, districtToggled, filtersCleared, ownerOnlyToggled, pageChanged, priceChanged, removedToggled, roomsToggled, searchChanged, sortChanged, sourceChanged, statusChanged } from "./model";

const chip = (on: boolean) =>
  cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium", on ? "border-primary bg-primary text-white" : "border-input bg-surface");

const has = (csv: string, key: string) => csv.split(",").includes(key);

export function FilterBar() {
  const { t } = useTranslation();
  const [districts, district, rooms, priceMin, priceMax, status, source, ownerOnly, removed, q] = useUnit([$districts, $district, $rooms, $priceMin, $priceMax, $status, $source, $ownerOnly, $removed, $q]);
  const [onDistrict, onRooms, onPrice, onStatus, onSource, onOwner, onRemoved, onSearch, onClear] = useUnit([districtToggled, roomsToggled, priceChanged, statusChanged, sourceChanged, ownerOnlyToggled, removedToggled, searchChanged, filtersCleared]);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-3">
      <Input className="w-full lg:w-80" placeholder={t("properties.filters.search")} value={q} onChange={(e) => onSearch(e.target.value)} aria-label={t("properties.filters.search")} maxLength={200} />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("properties.filters.district")}>
        {districts.map((d) => (
          <button key={d} type="button" className={chip(has(district, d))} aria-pressed={has(district, d)} onClick={() => onDistrict(d)}>{t(districtKey(d))}</button>
        ))}
      </div>
      <span className="text-xs text-muted-foreground">{t("properties.filters.rooms")}:</span>
      {(["1", "2", "3", "4"] as const).map((r) => (
        <button key={r} type="button" className={chip(has(rooms, r))} aria-pressed={has(rooms, r)} onClick={() => onRooms(r)}>{r === "4" ? t("properties.filters.roomsPlus") : r}</button>
      ))}
      <span className="text-xs text-muted-foreground">{t("properties.filters.price")}:</span>
      <Input className="w-20" inputMode="numeric" placeholder={t("properties.filters.priceMin")} value={priceMin} onChange={(e) => onPrice({ min: e.target.value, max: priceMax })} aria-label={t("properties.filters.priceMin")} />
      <Input className="w-20" inputMode="numeric" placeholder={t("properties.filters.priceMax")} value={priceMax} onChange={(e) => onPrice({ min: priceMin, max: e.target.value })} aria-label={t("properties.filters.priceMax")} />
      <span className="text-xs text-muted-foreground">{t("properties.filters.status")}:</span>
      {(["new", "active", "inactive"] as const).map((s) => (
        <button key={s} type="button" className={chip(has(status, s))} aria-pressed={has(status, s)} onClick={() => onStatus(s)}>{t(statusKey(s))}</button>
      ))}
      <Select value={source || "all"} onValueChange={(v) => onSource(v === "all" ? "" : v)}>
        <SelectTrigger className="h-8 w-36" aria-label={t("properties.filters.source")}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("properties.filters.source")}: {t("properties.filters.all")}</SelectItem>
          {(["olx", "telegram", "manual"] as const).map((k) => <SelectItem key={k} value={k}>{t(kindKey(k))}</SelectItem>)}
        </SelectContent>
      </Select>
      <label className="flex items-center gap-2 text-[13px]"><Switch checked={ownerOnly === "1"} onCheckedChange={() => onOwner()} />{t("properties.filters.ownerOnly")}</label>
      <label className="flex items-center gap-2 text-[13px]"><Switch checked={removed === "1"} onCheckedChange={() => onRemoved()} />{t("properties.filters.removed")}</label>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onClear()}>{t("properties.filters.clear")}</Button>
    </div>
  );
}

export function ResultsBar() {
  const { t } = useTranslation();
  const [total, sort, onSort] = useUnit([$total, $sort, sortChanged]);
  return (
    <div className="flex items-center justify-between">
      <b>{t("properties.count", { count: total })}</b>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">{t("properties.filters.sort")}
        <Select value={sort || "last_seen"} onValueChange={onSort}>
          <SelectTrigger className="h-8 w-44" aria-label={t("properties.filters.sort")}><SelectValue /></SelectTrigger>
          <SelectContent>{(["last_seen", "first_seen", "price_asc", "price_desc"] as const).map((s) => <SelectItem key={s} value={s}>{t(`properties.sort.${s}`)}</SelectItem>)}</SelectContent>
        </Select>
      </label>
    </div>
  );
}

export function Pagination() {
  const { t } = useTranslation();
  const [page, pages, onPage] = useUnit([$page, $pageCount, pageChanged]);
  const current = Number(page) || 1;
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-[13px]">
      <Button variant="secondary" size="sm" disabled={current <= 1} onClick={() => onPage(current - 1)}>{t("properties.prev")}</Button>
      <span className="num text-muted-foreground">{t("properties.page", { page: current, pages })}</span>
      <Button variant="secondary" size="sm" disabled={current >= pages} onClick={() => onPage(current + 1)}>{t("properties.next")}</Button>
    </div>
  );
}
