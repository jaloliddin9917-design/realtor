import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $listPending, $rows } from "@/entities/property";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { AddManualDialog } from "@/features/listing/add-manual";
import { $view, FilterBar, hovered, Pagination, ResultsBar, viewChanged } from "@/features/property/filters";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import { AppLayout } from "@/widgets/app-layout";
import { PropertyCardList } from "@/widgets/property-card-list";
import { PropertyMap } from "@/widgets/property-map";
import { PropertyTable } from "@/widgets/property-table";

/**
 * A card's id from the link it renders (`/properties/:id`) — used to sync hover without
 * `PropertyCardList` (owned by another lane) needing a hover callback of its own: one
 * delegated listener on the panel below beats wiring one onto every card.
 */
function propertyIdFromTarget(target: EventTarget | null): string | null {
  const link = target instanceof Element ? target.closest("a[href]") : null;
  const match = link ? /\/properties\/([^/?#]+)/.exec(link.getAttribute("href") ?? "") : null;
  return match?.[1] ?? null;
}

export function PropertiesPage() {
  const { t } = useTranslation();
  const [rows, pending, view] = useUnit([$rows, $listPending, $view]);
  const [onViewChanged, onHovered] = useUnit([viewChanged, hovered]);
  return (
    <AppLayout title={t("properties.title")} actions={<><AddManualDialog /><LanguageSwitch /></>}>
      <FilterBar />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ResultsBar />
        {/* no group-level aria-label: there is no dedicated "view mode" i18n key, and each
            button's own text ("List"/"Map") is already a clear accessible name on its own */}
        <div className="flex gap-1.5" role="group">
          <Button type="button" size="sm" variant={view === "list" ? "default" : "outline"} aria-pressed={view === "list"} onClick={() => onViewChanged("list")}>
            {t("properties.map.list")}
          </Button>
          <Button type="button" size="sm" variant={view === "map" ? "default" : "outline"} aria-pressed={view === "map"} onClick={() => onViewChanged("map")}>
            {t("properties.map.map")}
          </Button>
        </div>
      </div>
      {pending && rows.length === 0
        ? <Skeleton className="h-40 w-full" />
        : rows.length === 0
          ? <p className="p-6 text-center text-muted-foreground">{t("app.empty")}</p>
          : view === "map"
            ? (
              <div className="grid gap-3 lg:grid-cols-2">
                <div
                  className="max-h-[70vh] overflow-y-auto"
                  onMouseOver={(e) => { const id = propertyIdFromTarget(e.target); if (id) onHovered(id); }}
                  onMouseOut={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHovered(null); }}
                >
                  <PropertyCardList rows={rows} />
                </div>
                <div className="min-h-[70vh]"><PropertyMap /></div>
              </div>
            )
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
