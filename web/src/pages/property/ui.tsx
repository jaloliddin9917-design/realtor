import { Link } from "atomic-router-react";
import { useUnit } from "effector-react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { $detail, $detailPending } from "@/entities/property";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { districtKey } from "@/shared/i18n";
import { routes } from "@/shared/router";
import { Skeleton } from "@/shared/ui/skeleton";
import { AppLayout } from "@/widgets/app-layout";
import { ContactsList } from "@/widgets/contacts-list";
import { ListingsList } from "@/widgets/listings-list";
import { PropertyHeader, PropertySidebar } from "@/widgets/property-header";
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
          // the OLX two-column detail layout: a main column plus a sticky price/contact/CRM sidebar
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex min-w-0 flex-col gap-3">
              <PropertyHeader detail={detail} />
              <ListingsList listings={detail.listings} duplicates={detail.duplicates} />
              <div className="grid gap-3 sm:grid-cols-2">
                <ContactsList detail={detail} />
                <StatusTimeline events={detail.status_events} />
              </div>
            </div>
            <PropertySidebar detail={detail} className="lg:sticky lg:top-0" />
          </div>
        )}
    </AppLayout>
  );
}
