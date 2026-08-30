import { Link } from "atomic-router-react";
import { useUnit } from "effector-react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { $detail, $detailPending, StatusPill } from "@/entities/property";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { StatusButtons } from "@/features/property/set-status";
import { districtKey } from "@/shared/i18n";
import { routes } from "@/shared/router";
import { Skeleton } from "@/shared/ui/skeleton";
import { AppLayout } from "@/widgets/app-layout";
import { ContactsList } from "@/widgets/contacts-list";
import { ListingsList } from "@/widgets/listings-list";
import { PropertyHeader } from "@/widgets/property-header";
import { StatusTimeline } from "@/widgets/status-timeline";

export function PropertyPage() {
  const { t } = useTranslation();
  const [detail, pending] = useUnit([$detail, $detailPending]);
  const title = detail?.district ? t(districtKey(detail.district)) : t("property.back");
  return (
    <AppLayout title={title} actions={<LanguageSwitch />}>
      <Link to={routes.properties} className="inline-flex items-center gap-1 text-sm text-primary"><ArrowLeft className="size-4" />{t("property.back")}</Link>
      {!detail
        ? (pending ? <Skeleton className="h-64 w-full" /> : <p className="text-muted-foreground">{t("property.notFound")}</p>)
        : (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-3">
              <PropertyHeader detail={detail} />
              <div className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("property.statusTitle")}</span>
                  <StatusPill status={detail.status} />
                </div>
                <StatusButtons property={detail} />
              </div>
              <ListingsList listings={detail.listings} duplicates={detail.duplicates} />
            </div>
            <div className="flex flex-col gap-3">
              <ContactsList detail={detail} />
              <StatusTimeline events={detail.status_events} />
            </div>
          </div>
        )}
    </AppLayout>
  );
}
