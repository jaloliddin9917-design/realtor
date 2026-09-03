import { Link } from "atomic-router-react";
import { Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatTime, ownerLine, relativeLabel, type QueueItem, type QueueStateKind } from "@/entities/queue";
import { TakeButton } from "@/features/queue/take";
import { districtKey, kindKey } from "@/shared/i18n";
import { cn, formatUsdFromMinor } from "@/shared/lib";
import { routes } from "@/shared/router";
import { Button, buttonVariants } from "@/shared/ui/button";

const STATE_STYLES: Record<QueueStateKind, string> = {
  mine: "bg-owner-bg text-owner",
  new: "bg-status-new-bg text-status-new",
  locked: "bg-warn-bg text-warn",
  retry: "bg-status-inactive-bg text-status-inactive",
};

/** One queue card — rendering differs by `item.state.kind` (mine / new / locked / retry), per
 * the four card variants in the screen spec. Local to pages/queue (not a widget): only this
 * page ever renders it. */
export function QueueCard({ item }: { item: QueueItem }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { state } = item;

  const stateLabel =
    state.kind === "mine" ? t("queue.state.mine", { until: formatTime(state.until!, lang) })
    : state.kind === "locked" ? t("queue.state.locked", { agent: state.agentName, until: formatTime(state.until!, lang) })
    : state.kind === "retry" ? t("queue.state.retry", { time: relativeLabel(item.lastActivity.at, lang, t), source: t(kindKey(item.source)) })
    : t("queue.state.new", { time: relativeLabel(item.lastActivity.at, lang, t), source: t(kindKey(item.source)) });

  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold", STATE_STYLES[state.kind])}>{stateLabel}</span>
        <span className="num text-xs text-muted-foreground">#{item.id}</span>
      </div>

      <div>
        <div className="font-semibold">{t(districtKey(item.district))}, {item.subArea}</div>
        <div className="text-xs text-muted-foreground">{t("queue.attrs", { rooms: item.rooms, floor: item.floor, total: item.totalFloors, area: Math.round(item.areaSqm) })}</div>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="num text-lg font-bold">{formatUsdFromMinor(item.priceUsd * 100)}</span>
        <span className="text-xs text-muted-foreground">{t("queue.perMonth")}</span>
      </div>

      {state.kind === "mine" && item.availability.status === "vacant" && (
        <span className="inline-flex h-6 w-fit items-center gap-1.5 rounded-full bg-status-active-bg px-2.5 text-xs font-semibold text-status-active">
          <span className="size-[7px] rounded-full bg-current" />{t("queue.availabilityVacant", { time: relativeLabel(item.availability.at, lang, t) })}
        </span>
      )}

      <div className="text-sm">{ownerLine(item.owner, t)}</div>

      <div className="text-xs text-muted-foreground">
        {state.kind === "locked" ? t("queue.lockedNote", { until: formatTime(state.until!, lang) }) : item.lastActivity.text}
      </div>

      <div className="mt-1 flex gap-2">
        {state.kind === "mine" && (
          <>
            {item.owner.phone && (
              <a href={`tel:${item.owner.phone}`} className={cn(buttonVariants({ size: "sm" }))}>
                <Phone className="size-4" />{t("queue.callButton")}
              </a>
            )}
            <Link to={routes.call} params={{ id: item.id }} className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}>
              {t("queue.resultButton")}
            </Link>
          </>
        )}
        {state.kind === "new" && <TakeButton id={item.id} variant="new" />}
        {state.kind === "retry" && <TakeButton id={item.id} variant="retry" />}
        {state.kind === "locked" && <Button size="sm" variant="secondary" disabled>{t("queue.lockedButton")}</Button>}
      </div>
    </div>
  );
}
