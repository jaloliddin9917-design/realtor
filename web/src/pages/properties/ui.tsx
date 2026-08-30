import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $listPending, $rows } from "@/entities/property";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { FilterBar, Pagination, ResultsBar } from "@/features/property/filters";
import { Skeleton } from "@/shared/ui/skeleton";
import { AppLayout } from "@/widgets/app-layout";
import { PropertyCardList } from "@/widgets/property-card-list";
import { PropertyTable } from "@/widgets/property-table";

export function PropertiesPage() {
  const { t } = useTranslation();
  const [rows, pending] = useUnit([$rows, $listPending]);
  return (
    <AppLayout title={t("properties.title")} actions={<LanguageSwitch />}>
      <FilterBar />
      <ResultsBar />
      {pending && rows.length === 0
        ? <Skeleton className="h-40 w-full" />
        : rows.length === 0
          ? <p className="p-6 text-center text-muted-foreground">{t("app.empty")}</p>
          : (
            <>
              {/* one source of rows, two renderings: the table from lg up, cards below */}
              <div className="hidden lg:block"><PropertyTable rows={rows} /></div>
              <div className="lg:hidden"><PropertyCardList rows={rows} /></div>
            </>
          )}
      <Pagination />
    </AppLayout>
  );
}
