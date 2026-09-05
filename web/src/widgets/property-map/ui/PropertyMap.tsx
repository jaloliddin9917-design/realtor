import { lazy, Suspense, useMemo } from "react";
import { useUnit } from "effector-react";
import { ImageOff, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { $meta } from "@/entities/meta";
import { $pins, $pinsPending, StatusPill } from "@/entities/property";
import { $bounds, $hoveredId, $searchArea, boundsChanged, searchAreaToggled } from "@/features/property/filters";
import { districtKey } from "@/shared/i18n";
import { formatMoney, formatUsdFromMinor } from "@/shared/lib";
import { routes } from "@/shared/router";
import { Button } from "@/shared/ui/button";
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
 * that opens a photo/price/details popup for that pin (with an explicit "Open" button through to
 * the property, rather than navigating straight away), and an opt-in "search this area" bounding
 * box.
 */
export function PropertyMap() {
  const { t, i18n } = useTranslation();
  const [pins, pending, hoveredId, searchArea, meta] = useUnit([$pins, $pinsPending, $hoveredId, $searchArea, $meta]);
  const [onSearchAreaToggled, onBoundsChanged, navigateToProperty] = useUnit([searchAreaToggled, boundsChanged, routes.property.navigate]);
  const fx = meta?.fx ?? null;

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
            onBoundsChange={(b: MapBounds) => onBoundsChanged(b)}
            className="h-full min-h-[70vh] w-full rounded-card"
            renderPopup={(id, close) => {
              const pin = pins.find((p) => p.id === id);
              if (!pin) return null;
              const approxUzs = fx && pin.price_usd_min_minor !== null
                ? t("call.approxSum", { amount: formatMoney(pin.price_usd_min_minor * Number(fx.usd_uzs), "UZS", i18n.language) })
                : null;
              const attrs = [
                pin.rooms !== null ? t("properties.rooms", { count: pin.rooms }) : null,
                pin.floor !== null && pin.total_floors !== null ? t("properties.floor", { floor: pin.floor, total: pin.total_floors }) : null,
                pin.area_sqm !== null ? t("properties.area", { area: Math.round(pin.area_sqm) }) : null,
              ].filter(Boolean);
              return (
                <div className="w-60 overflow-hidden rounded-card border border-line bg-surface shadow-lg">
                  <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-soft">
                    {pin.photo_url
                      ? <img src={pin.photo_url} alt="" className="size-full object-cover" />
                      : <div className="flex size-full items-center justify-center text-muted-foreground"><ImageOff className="size-8" aria-hidden="true" /></div>}
                    <button
                      type="button"
                      aria-label={t("app.close")}
                      onClick={close}
                      className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-surface/90 text-ink shadow-sm hover:bg-surface"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <div className="flex flex-col gap-1.5 p-3">
                    <div className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="num text-lg font-extrabold tracking-tight text-price">{formatUsdFromMinor(pin.price_usd_min_minor)}</span>
                      <span className="text-xs font-semibold text-muted-foreground">{t("property.perMonth")}</span>
                      {approxUzs && <span className="num ml-auto text-xs font-medium text-muted-foreground">{approxUzs}</span>}
                    </div>
                    {attrs.length > 0 && <div className="text-xs text-muted-foreground">{attrs.join(" · ")}</div>}
                    <div className="truncate text-xs text-muted-foreground">{pin.district ? t(districtKey(pin.district)) : pin.location_label}</div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <StatusPill status={pin.status} />
                      <Button size="sm" onClick={() => navigateToProperty({ params: { id: pin.id }, query: {} })}>
                        {t("properties.map.open")}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            }}
          />
        </Suspense>
      </div>
    </div>
  );
}
