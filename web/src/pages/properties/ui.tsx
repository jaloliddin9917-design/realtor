import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $listPending, $rows } from "@/entities/property";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { AddManualDialog } from "@/features/listing/add-manual";
import { $view, FilterBar, hovered, Pagination, ResultsBar } from "@/features/property/filters";
import { Skeleton } from "@/shared/ui/skeleton";
import { AppLayout } from "@/widgets/app-layout";
import { PropertyCardList } from "@/widgets/property-card-list";
import { PropertyMap } from "@/widgets/property-map";

/**
 * A card's id from the link it renders (`/properties/:id`) — used to sync hover via one
 * delegated listener on the panel below, rather than `PropertyCardList` needing a hover
 * callback wired onto every card.
 */
function propertyIdFromTarget(target: EventTarget | null): string | null {
  const link = target instanceof Element ? target.closest("a[href]") : null;
  const match = link ? /\/properties\/([^/?#]+)/.exec(link.getAttribute("href") ?? "") : null;
  return match?.[1] ?? null;
}

/** Anchor the filter rail's primary CTA scrolls to (see `FilterBar`) — filters already apply
 * live, so that button is a "jump to the results" affordance rather than a real submit. */
const RESULTS_ANCHOR_ID = "properties-results";

export function PropertiesPage() {
  const { t } = useTranslation();
  const [rows, pending, view] = useUnit([$rows, $listPending, $view]);
  const onHovered = useUnit(hovered);
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
            // $rows (paginated) and $pins (unpaged) are decoupled: the map can have pins to show
            // even when the current rows page is empty (paginated past the last page, or "search
            // this area" panned to a sparse spot), so the split layout — and the map itself — must
            // never collapse just because this page's rows are empty. The map owns its own
            // loading/empty state (see `PropertyMap`); only the left column falls back to a note.
            ? (
              <div className="grid gap-3 lg:grid-cols-2">
                <div
                  className="max-h-[70vh] overflow-y-auto"
                  onMouseOver={(e) => { const id = propertyIdFromTarget(e.target); if (id) onHovered(id); }}
                  onMouseOut={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHovered(null); }}
                >
                  {/* narrower column than the plain list view, so it stays single-column
                      regardless of viewport width */}
                  {rows.length === 0 ? emptyNote : <PropertyCardList rows={rows} className="grid-cols-1" />}
                </div>
                <div className="min-h-[70vh]"><PropertyMap /></div>
              </div>
            )
            : pending && rows.length === 0
              ? <Skeleton className="h-40 w-full" />
              : rows.length === 0
                ? emptyNote
                : <PropertyCardList rows={rows} />}
          <Pagination />
        </div>
      </div>
    </AppLayout>
  );
}
