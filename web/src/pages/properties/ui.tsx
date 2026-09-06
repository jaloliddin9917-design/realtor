import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $listPending, $rows } from "@/entities/property";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { AddManualDialog } from "@/features/listing/add-manual";
import { $view, FilterBar, Pagination, ResultsBar } from "@/features/property/filters";
import { Skeleton } from "@/shared/ui/skeleton";
import { AppLayout } from "@/widgets/app-layout";
import { PropertyCardList } from "@/widgets/property-card-list";
import { PropertyMap } from "@/widgets/property-map";

/** Anchor the filter rail's primary CTA scrolls to (see `FilterBar`) — filters already apply
 * live, so that button is a "jump to the results" affordance rather than a real submit. */
const RESULTS_ANCHOR_ID = "properties-results";

export function PropertiesPage() {
  const { t } = useTranslation();
  const [rows, pending, view] = useUnit([$rows, $listPending, $view]);
  const emptyNote = <p className="p-6 text-center text-muted-foreground">{t("app.empty")}</p>;
  return (
    <AppLayout title={t("properties.title")} actions={<><AddManualDialog /><LanguageSwitch /></>}>
      {/* OLX mockup's `.list-layout`: a sticky ~264px rail + the results column. `order` swaps
          them so the rail stacks *under* the results on mobile while staying visually first
          (left) from `lg:` up, without duplicating either in the markup. */}
      <div className="grid gap-4 lg:grid-cols-[264px_1fr] lg:items-start">
        {/* The rail is taller than the viewport, so on lg+ it sticks and scrolls *within itself*
            (max-height = viewport minus the topbar + top offset), keeping its scroll from chaining
            to the results column. On mobile it just flows in the page (order-2, below the results). */}
        <aside className="order-2 lg:sticky lg:top-6 lg:order-1 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overscroll-contain"><FilterBar /></aside>
        <div id={RESULTS_ANCHOR_ID} className="order-1 flex min-w-0 flex-col gap-3 lg:order-2">
          <ResultsBar />
          {view === "map"
            // Map mode shows the map full-width alongside the filter rail — no card column.
            // The map owns its own loading/empty state (see `PropertyMap`), and its pins are
            // unpaged, so there's no pagination in this mode.
            ? <div className="h-[calc(100vh-11rem)] min-h-[440px]"><PropertyMap /></div>
            : pending && rows.length === 0
              ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-card" />)}
                </div>
              )
              : rows.length === 0
                ? emptyNote
                : <PropertyCardList rows={rows} />}
          {view !== "map" && <Pagination />}
        </div>
      </div>
    </AppLayout>
  );
}
