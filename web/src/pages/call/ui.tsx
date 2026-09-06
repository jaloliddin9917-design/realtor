import { useEffect } from "react";
import { Link } from "atomic-router-react";
import { useUnit } from "effector-react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { $items, $queuePending, type OwnerClassification } from "@/entities/queue";
import { formReset, LogResultForm } from "@/features/call/log-result";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { classificationKey, districtKey } from "@/shared/i18n";
import { cn, formatPhone } from "@/shared/lib";
import { routes } from "@/shared/router";
import { Skeleton } from "@/shared/ui/skeleton";
import { AppLayout } from "@/widgets/app-layout";
import { CallHeader } from "./ui/CallHeader";

const CLASSIFICATION_STYLES: Record<OwnerClassification, string> = {
  owner: "bg-owner-bg text-owner",
  agent: "bg-agent-bg text-agent",
  unknown: "bg-status-new-bg text-status-new",
};

export function CallPage() {
  const { t } = useTranslation();
  const [items, params, reset, pending] = useUnit([$items, routes.call.$params, formReset, $queuePending]);
  const item = items.find((i) => i.id === params.id) ?? null;

  // These are plain global stores (features/call/log-result/model.ts), so a draft typed for
  // one item must be cleared whenever the route's :id changes to another — including the very
  // first mount — or it would leak onto the next item opened.
  useEffect(() => { reset(); }, [params.id, reset]);

  const title = item ? t(districtKey(item.district)) : t("call.back");

  return (
    <AppLayout title={title} actions={<LanguageSwitch />}>
      <Link to={routes.queue} className="inline-flex items-center gap-1 text-sm text-primary"><ArrowLeft className="size-4" />{t("call.back")}</Link>
      {pending && !item ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Skeleton className="h-96 rounded-card" />
          <Skeleton className="h-64 rounded-card" />
        </div>
      ) : !item ? (
        <p className="text-muted-foreground">{t("call.notFound")}</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <CallHeader item={item} />
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("call.result.title")}</span>
              <div className="flex items-center gap-2">
                <span className="num font-mono">{item.owner.phone ? formatPhone(item.owner.phone) : "—"}</span>
                <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-xs font-semibold", CLASSIFICATION_STYLES[item.owner.classification])}>
                  {t(classificationKey(item.owner.classification))}
                </span>
              </div>
            </div>
            <LogResultForm queueItemId={item.id} />
          </div>
        </div>
      )}
    </AppLayout>
  );
}
