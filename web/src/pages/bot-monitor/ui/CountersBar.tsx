import { useUnit } from "effector-react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { $botPending, $counters, refreshRequested } from "@/entities/bot";
import { cn } from "@/shared/lib";
import { Button } from "@/shared/ui/button";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="num text-lg font-bold">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export function CountersBar() {
  const { t } = useTranslation();
  const [counters, refresh, pending] = useUnit([$counters, refreshRequested, $botPending]);
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-card border border-line bg-surface p-3">
      <Stat label={t("bot.counters.today")} value={counters.today} />
      <Stat label={t("bot.result.queued")} value={counters.queued} />
      <Stat label={t("bot.counters.replied")} value={counters.replied} />
      <Stat label={t("bot.result.unclear")} value={counters.unclear} />
      <Stat label={t("bot.counters.errors")} value={counters.errors} />
      <Button type="button" variant="secondary" size="sm" className="ml-auto" disabled={pending} onClick={() => refresh()}>
        <RefreshCw className={cn("size-4", pending && "animate-spin")} />{t("bot.refresh")}
      </Button>
    </div>
  );
}
