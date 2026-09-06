import { Link } from "atomic-router-react";
import { Check, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatTime, type OwnerClassification, type QueueItem, type QueueStateKind, relativeLabel } from "@/entities/queue";
import { TakeButton } from "@/features/queue/take";
import { classificationKey, districtKey, kindKey } from "@/shared/i18n";
import { cn, formatPhone, formatUsdFromMinor } from "@/shared/lib";
import { routes } from "@/shared/router";
import { Button, buttonVariants } from "@/shared/ui/button";

const STRIPE: Record<QueueStateKind, string> = {
  mine: "bg-status-active", new: "bg-status-new", locked: "bg-warn", retry: "bg-status-inactive",
};
const STATE_CHIP: Record<QueueStateKind, string> = {
  mine: "bg-status-active-bg text-status-active",
  new: "bg-status-new-bg text-status-new",
  locked: "bg-warn-bg text-warn",
  retry: "bg-status-inactive-bg text-status-inactive",
};
const OWNER_CHIP: Record<OwnerClassification, string> = {
  owner: "bg-owner-bg text-owner",
  agent: "bg-agent-bg text-agent",
  unknown: "bg-status-new-bg text-status-new",
};

/** One queue card. A left severity stripe + matching chip encode the state (mine / new /
 * locked / retry) at a glance; "mine" cards get a faint ring. Local to pages/queue. */
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
    <div className={cn("relative flex flex-col gap-2.5 overflow-hidden rounded-card border border-line bg-surface p-3.5 pl-4 shadow-sm", state.kind === "mine" && "ring-1 ring-status-active/25")}>
      <span className={cn("absolute inset-y-0 left-0 w-1", STRIPE[state.kind])} aria-hidden />

      <div className="flex items-center gap-2">
        <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold", STATE_CHIP[state.kind])}>
          {state.kind === "mine" && <Check className="size-3" />}{stateLabel}
        </span>
        <span className="num ml-auto text-xs text-muted-foreground">#{item.id}</span>
      </div>

      <div>
        <div className="font-semibold tracking-tight">{t(districtKey(item.district))}, {item.subArea}</div>
        <div className="text-xs text-muted-foreground">{t("queue.attrs", { rooms: item.rooms, floor: item.floor, total: item.totalFloors, area: Math.round(item.areaSqm) })}</div>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="num text-xl font-extrabold text-price">{formatUsdFromMinor(item.priceUsd * 100)}</span>
        <span className="text-xs text-muted-foreground">{t("queue.perMonth")}</span>
      </div>

      {state.kind === "mine" && item.availability.status === "vacant" && (
        <span className="inline-flex h-6 w-fit items-center gap-1.5 rounded-full bg-status-active-bg px-2.5 text-xs font-semibold text-status-active">
          <span className="size-[7px] rounded-full bg-current" />{t("queue.availabilityVacant", { time: relativeLabel(item.availability.at, lang, t) })}
        </span>
      )}

      <div className="flex items-center gap-2 border-t border-line-soft pt-2.5">
        <span className="num font-mono text-sm">{item.owner.phone ? formatPhone(item.owner.phone) : "—"}</span>
        <span className={cn("ml-auto inline-flex h-5 items-center whitespace-nowrap rounded-full px-2 text-[11px] font-semibold", OWNER_CHIP[item.owner.classification])}>
          {t(classificationKey(item.owner.classification))}
          {item.owner.homeCount !== undefined && <> · {t("duplicates.contact.homesCount", { count: item.owner.homeCount })}</>}
        </span>
      </div>

      {state.kind === "locked" && (
        <div className="text-xs text-muted-foreground">{t("queue.lockedNote", { until: formatTime(state.until!, lang) })}</div>
      )}
      {(state.kind === "new" || state.kind === "retry") && (
        <div className="text-xs text-muted-foreground">{item.lastActivity.text}</div>
      )}

      <div className="mt-0.5 flex gap-2">
        {state.kind === "mine" && (
          <>
            {item.owner.phone && (
              <a href={`tel:${item.owner.phone}`} className={cn(buttonVariants({ size: "sm" }), "flex-1")}>
                <Phone className="size-4" />{t("queue.callButton")}
              </a>
            )}
            <Link to={routes.call} params={{ id: item.id }} className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "flex-1")}>
              {t("queue.resultButton")}
            </Link>
          </>
        )}
        {state.kind === "new" && <TakeButton id={item.id} variant="new" />}
        {state.kind === "retry" && <TakeButton id={item.id} variant="retry" />}
        {state.kind === "locked" && <Button size="sm" variant="secondary" disabled className="flex-1">{t("queue.lockedButton")}</Button>}
      </div>
    </div>
  );
}
