import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $current, $index, $pairs, $thresholds, pairSelected, type ScoreBreakdownItem } from "@/entities/duplicate";
import { DecisionButtons } from "@/features/duplicate/decide";
import { Button } from "@/shared/ui/button";
import { ListingCard } from "./ListingCard";

function BreakdownRow({ item }: { item: ScoreBreakdownItem }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span>{t(`duplicates.breakdown.${item.id}`)}</span>
      <span className="num font-semibold text-primary">+{item.points.toFixed(2)}</span>
    </div>
  );
}

/** The right-hand review panel — the featured pair's heading, pager, A/B cards, score breakdown and decision buttons. */
export function ComparePanel() {
  const { t } = useTranslation();
  const [current, index, pairs, thresholds, select] = useUnit([$current, $index, $pairs, $thresholds, pairSelected]);
  if (!current) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-card border border-line bg-surface p-3.5">
        <div>
          <h2 className="text-base font-semibold">{t("duplicates.heading")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("duplicates.headingSub", { score: current.score.toFixed(2), low: thresholds.low.toFixed(2), high: thresholds.high.toFixed(2) })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="num text-sm text-muted-foreground">{t("duplicates.pager.position", { index: index + 1, total: pairs.length })}</span>
          <Button variant="outline" size="sm" disabled={index === 0} onClick={() => select(index - 1)}>{t("duplicates.pager.prev")}</Button>
          <Button variant="outline" size="sm" disabled={index === pairs.length - 1} onClick={() => select(index + 1)}>{t("duplicates.pager.next")}</Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ListingCard label="A" listing={current.a} />
        <ListingCard label="B" listing={current.b} />
      </div>

      <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("duplicates.breakdown.title")}</h3>
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {current.breakdown.map((item) => <BreakdownRow key={item.id} item={item} />)}
        </div>
      </div>

      <DecisionButtons />
    </div>
  );
}
