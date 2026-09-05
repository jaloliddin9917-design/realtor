import { lazy, Suspense, useMemo } from "react";
import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $pins, $pinsPending } from "@/entities/property";
import { $bounds, $hoveredId, $searchArea, boundsChanged, searchAreaToggled } from "@/features/property/filters";
import { formatUsdFromMinor } from "@/shared/lib";
import { routes } from "@/shared/router";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";
import type { MapBounds, MapPoint } from "@/shared/ui/map";

// The map view is the one screen that needs maplibre-gl — everyone who only ever uses the list
// should not pay for that bundle. `import type` above is erased at compile time (no runtime
// import), so this `lazy()` call is the *only* thing that pulls the map widget's real code in,
// and only once this component actually mounts.
const MapView = lazy(() => import("@/shared/ui/map").then((m) => ({ default: m.MapView })));

/**
 * The map-mode right panel: `$pins` plotted as clustered markers, hover-synced with the card
 * list (`$hoveredId` is set by whichever card the pointer is over — wired in
 * `pages/properties`, since `PropertyCardList` exposes no hover callback of its own), a click
 * that goes straight to the property, and an opt-in "search this area" bounding box.
 */
export function PropertyMap() {
  const { t } = useTranslation();
  const [pins, pending, hoveredId, searchArea] = useUnit([$pins, $pinsPending, $hoveredId, $searchArea]);
  const [onSearchAreaToggled, onBoundsChanged, navigateToProperty] = useUnit([searchAreaToggled, boundsChanged, routes.property.navigate]);

  const points: MapPoint[] = useMemo(
    () => pins.map((p) => ({ id: p.id, lat: p.latitude, lon: p.longitude, label: formatUsdFromMinor(p.price_usd_min_minor) })),
    [pins],
  );

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-[13px]">
        <label className="flex items-center gap-2">
          <Switch checked={searchArea === "1"} onCheckedChange={() => onSearchAreaToggled()} />
          {t("properties.map.searchArea")}
        </label>
        <span className="text-muted-foreground">{t("properties.map.pinsCount", { count: pins.length })}</span>
      </div>
      <div className="relative min-h-[70vh] flex-1">
        {/* a floating badge, not a blocking overlay — an empty result for the current filters
            should not stop the user from panning around to "search this area" instead */}
        {!pending && pins.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
            <span className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted-foreground shadow-sm">
              {t("properties.map.noCoords")}
            </span>
          </div>
        )}
        <Suspense fallback={<Skeleton className="h-full min-h-[70vh] w-full" />}>
          <MapView
            points={points}
            hoveredId={hoveredId}
            onPinClick={(id) => navigateToProperty({ params: { id }, query: {} })}
            onBoundsChange={(b: MapBounds) => onBoundsChanged(b)}
            className="h-full min-h-[70vh] w-full rounded-card"
          />
        </Suspense>
      </div>
    </div>
  );
}
