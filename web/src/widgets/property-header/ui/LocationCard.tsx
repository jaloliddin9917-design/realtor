import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { PropertyDetail } from "@/entities/property";
import { Skeleton } from "@/shared/ui/skeleton";

// Lazy-loaded so MapLibre (and its ~200kb+ of GL code) stays out of the main bundle — most
// property views never scroll down to the map.
const MapView = lazy(() => import("@/shared/ui/map").then((m) => ({ default: m.MapView })));

/** The property's approximate location: a label plus a single-marker mini-map with its search
 * radius. Renders nothing when there are no coordinates to show. */
export function LocationCard({ detail }: { detail: PropertyDetail }) {
  const { t } = useTranslation();
  if (detail.latitude == null || detail.longitude == null) return null;

  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("property.location")}</span>
      {detail.location_label && <span className="text-sm">{detail.location_label}</span>}
      <Suspense fallback={<Skeleton className="h-56 w-full" />}>
        <MapView
          singleMarker
          points={[{ id: detail.id, lat: detail.latitude!, lon: detail.longitude! }]}
          radiusMeters={detail.location_radius_m}
          center={[detail.longitude!, detail.latitude!]}
          className="h-56 w-full rounded-card"
        />
      </Suspense>
      <span className="text-xs text-muted-foreground">{t("property.approximateArea")}</span>
    </div>
  );
}
