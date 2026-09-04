import type { TFunction } from "i18next";
import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $decidedRecent, $index, $pairs, $thresholds, pairSelected, type DuplicatePair } from "@/entities/duplicate";
import { cn } from "@/shared/lib";
import { districtKey, kindKey } from "@/shared/i18n";
import { Badge } from "@/shared/ui/badge";
import { Separator } from "@/shared/ui/separator";

/** Only the first page of the queue is listed as rows; the rest are still reachable through the pager. */
const VISIBLE = 6;

/**
 * "N soat oldin" while under a day old, else a flat "kecha" catch-all. Unlike
 * `entities/queue`'s `relativeLabel` (minutes/hours/yesterday/days), a review pair is expected
 * to stay fresh, so this coarser two-bucket age is enough to tell what's newest.
 */
function ageLabel(createdAt: string, t: TFunction): string {
  const hours = Math.max(1, Math.round((Date.now() - new Date(createdAt).getTime()) / 3_600_000));
  return hours < 24 ? t("duplicates.pair.hoursAgo", { hours }) : t("duplicates.pair.yesterday");
}

function QueueRow({ pair, active, onSelect }: { pair: DuplicatePair; active: boolean; onSelect: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-0.5 rounded-lg border p-2.5 text-left transition-colors",
        active ? "border-primary bg-accent" : "border-line-soft bg-surface hover:bg-surface-soft",
      )}
    >
      <div className="text-sm font-semibold"><span className="num">{pair.score.toFixed(2)}</span></div>
      {/* The queue row summarizes side A (the newly seen listing that triggered this review) — the
          API has no pair-level district/rooms, only each side's own. */}
      <div className="text-sm">{pair.a.district ? t(districtKey(pair.a.district)) : "—"} · {t("properties.rooms", { count: pair.a.rooms })}</div>
      <div className="text-xs text-muted-foreground">{t(kindKey(pair.a.sourceKind))} ↔ {t(kindKey(pair.b.sourceKind))} · {ageLabel(pair.createdAt, t)}</div>
    </button>
  );
}

export function QueuePanel() {
  const { t } = useTranslation();
  const [pairs, index, thresholds, decidedRecent, select] = useUnit([$pairs, $index, $thresholds, $decidedRecent, pairSelected]);
  const visible = pairs.slice(0, VISIBLE);
  const hidden = pairs.length - visible.length;
  return (
    <div className="flex h-fit flex-col gap-3 rounded-card border border-line bg-surface p-3.5">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{t("duplicates.queue.title")}</h2>
        <Badge variant="secondary">{pairs.length}</Badge>
      </div>
      <div className="flex flex-col gap-2">
        {visible.map((pair, i) => (
          <QueueRow key={pair.id} pair={pair} active={i === index} onSelect={() => select(i)} />
        ))}
      </div>
      {hidden > 0 && <span className="text-xs text-muted-foreground">{t("duplicates.queue.more", { count: hidden })}</span>}
      <Separator />
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>{t("duplicates.queue.recent", { days: decidedRecent.days, count: decidedRecent.count, pct: decidedRecent.mergedPct })}</span>
        <span>{t("duplicates.queue.thresholds", { auto: thresholds.auto.toFixed(2), low: thresholds.low.toFixed(2), high: thresholds.high.toFixed(2) })}</span>
      </div>
    </div>
  );
}
