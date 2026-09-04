import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $meta } from "@/entities/meta";
import type { QueueItem } from "@/entities/queue";
import { districtKey } from "@/shared/i18n";
import { formatMoney, formatUsdFromMinor } from "@/shared/lib";

const PHOTO_TOTAL = 7;
const PHOTO_THUMB_COUNT = 5;

/** The property snapshot at the top of the call-log screen — photos are colour placeholders,
 * no real images (per the screen spec). Local to pages/call: only this page renders it. */
export function CallHeader({ item }: { item: QueueItem }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  // The session-wide fx snapshot (entities/meta, loaded once via app/router's loadMetaFx — this
  // screen is one of its trigger routes). No fabricated fallback: if the rate hasn't loaded yet
  // (or the backend has never fetched one), the so'm line is simply not shown.
  const meta = useUnit($meta);
  const fx = meta?.fx ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-base font-semibold">
        {t(districtKey(item.district))}, {item.subArea} · {t("call.rooms", { count: item.rooms })} · #{item.id}
      </div>

      <div className="grid grid-cols-[2fr_1fr] grid-rows-[96px_96px] gap-1.5 lg:grid-rows-[160px_160px]">
        <div className="relative row-span-2 flex items-end rounded-lg bg-[#d8e2df] p-2">
          <span className="rounded bg-black/50 px-1.5 py-0.5 text-xs font-medium text-white">{t("call.photoLabel", { n: 1, total: PHOTO_TOTAL })}</span>
        </div>
        <div className="rounded-lg bg-[#e3ded2]" />
        <div className="flex items-center justify-center rounded-lg bg-[#dde3ea] text-sm font-semibold text-[#3f4d49]">{t("call.photoCount", { count: PHOTO_THUMB_COUNT })}</div>
      </div>

      <div className="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-3.5">
        <div className="flex flex-wrap items-baseline gap-1.5">
          <span className="num text-[22px] font-bold">{formatUsdFromMinor(item.priceUsd * 100)}</span>
          <span className="text-xs text-muted-foreground">{t("call.perMonth")}</span>
          {fx && <span className="num text-sm text-muted-foreground">{t("call.approxSum", { amount: formatMoney(item.priceUsd * Number(fx.usd_uzs) * 100, "UZS", lang) })}</span>}
        </div>
        <div className="text-sm text-muted-foreground">{t("call.attrs", { rooms: item.rooms, floor: item.floor, total: item.totalFloors, area: Math.round(item.areaSqm) })}</div>
      </div>
    </div>
  );
}
