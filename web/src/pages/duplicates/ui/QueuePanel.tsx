import { useUnit } from "effector-react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { $decidedIds, $index, $pairs, pairSelected, RECENT_DECISIONS, SCORE_THRESHOLDS, type DuplicatePair } from "@/entities/duplicate";
import { cn } from "@/shared/lib";
import { districtKey, kindKey } from "@/shared/i18n";
import { Badge } from "@/shared/ui/badge";
import { Separator } from "@/shared/ui/separator";

/** Only the first page of the queue is listed as rows; the rest are still reachable through the pager. */
const VISIBLE = 6;

function QueueRow({ pair, active, decided, onSelect }: { pair: DuplicatePair; active: boolean; decided: boolean; onSelect: () => void }) {
  const { t } = useTranslation();
  const age = pair.age.kind === "hours" ? t("duplicates.pair.hoursAgo", { hours: pair.age.hours }) : t("duplicates.pair.yesterday");
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-0.5 rounded-lg border p-2.5 text-left transition-colors",
        active ? "border-primary bg-accent" : "border-line-soft bg-surface hover:bg-surface-soft",
      )}
    >
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <span className="num">{pair.score.toFixed(2)}</span>
        {decided && <Check className="size-3.5 text-status-active" aria-hidden />}
      </div>
      <div className="text-sm">{t(districtKey(pair.district))}, {pair.place} · {t("properties.rooms", { count: pair.rooms })}</div>
      <div className="text-xs text-muted-foreground">{t(kindKey(pair.a.sourceKind))} ↔ {t(kindKey(pair.b.sourceKind))} · {age}</div>
    </button>
  );
}

export function QueuePanel() {
  const { t } = useTranslation();
  const [pairs, index, decidedIds, select] = useUnit([$pairs, $index, $decidedIds, pairSelected]);
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
          <QueueRow key={pair.id} pair={pair} active={i === index} decided={decidedIds.has(pair.id)} onSelect={() => select(i)} />
        ))}
      </div>
      {hidden > 0 && <span className="text-xs text-muted-foreground">{t("duplicates.queue.more", { count: hidden })}</span>}
      <Separator />
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>{t("duplicates.queue.recent", { days: RECENT_DECISIONS.days, count: RECENT_DECISIONS.count, pct: RECENT_DECISIONS.mergedPct })}</span>
        <span>{t("duplicates.queue.thresholds", { auto: SCORE_THRESHOLDS.auto.toFixed(2), low: SCORE_THRESHOLDS.low.toFixed(2), high: SCORE_THRESHOLDS.high.toFixed(2) })}</span>
      </div>
    </div>
  );
}
