import "ol/ol.css";
import { useEffect, useRef, useState } from "react";
import OlMap from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import OSM from "ol/source/OSM";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Cluster from "ol/source/Cluster";
import Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import Point from "ol/geom/Point";
import CircleGeom from "ol/geom/Circle";
import Overlay from "ol/Overlay";
import { fromLonLat, toLonLat } from "ol/proj";
import { boundingExtent } from "ol/extent";
import { Circle as CircleStyle, Fill, Icon, Stroke, Style, Text } from "ol/style";
import { defaults as defaultControls } from "ol/control/defaults";
import { TASHKENT_CENTER } from "./style";

export interface MapPoint { id: string; lat: number; lon: number; label?: string }
export interface MapBounds { minLat: number; minLon: number; maxLat: number; maxLon: number }

export interface MapViewProps {
  points?: MapPoint[];
  center?: [number, number];
  zoom?: number;
  radiusMeters?: number | null;
  onPinClick?: (id: string) => void;
  onBoundsChange?: (bounds: MapBounds) => void;
  hoveredId?: string | null;
  /** Explicit mode switch: one marker (+ optional radius circle) instead of the clustered source/layer. Fixed per instance — never toggled at runtime. Default false. */
  singleMarker?: boolean;
  className?: string;
  /** Renders a click-popup's contents for the given pin id; `close` clears the selection and
   * hides the popup overlay. When given, clicking an unclustered pin opens this popup instead of
   * calling `onPinClick` — the two are mutually exclusive per click. Ignored in `singleMarker`
   * mode, which registers no click handler at all. */
  renderPopup?: (id: string, close: () => void) => React.ReactNode;
}

const TEAL = "#0f6e63";
const TEAL_DARK = "#0b5349";
const TEAL_CLUSTER_FILL = "rgba(15, 110, 99, 0.88)";
const TEAL_RADIUS_FILL = "rgba(15, 110, 99, 0.12)";
/** Feature id for the single-marker mode's optional radius-circle feature — distinct from any real point id, which lets the marker and the circle share one VectorSource. */
const RADIUS_FEATURE_ID = "__radius__";

const PIN_WIDTH = 28;
const PIN_HEIGHT = 38;

/** A teardrop map-pin as an inline SVG data URI (no icon font, no network request): a circular
 * head tapering to a point at the bottom-center, matching the `anchor: [0.5, 1]` in `pinStyle`
 * below. */
function pinIconSrc(fillColor: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_WIDTH}" height="${PIN_HEIGHT}" viewBox="0 0 ${PIN_WIDTH} ${PIN_HEIGHT}"><path d="M14 1C7.373 1 2 6.373 2 13c0 9 12 24 12 24s12-15 12-24c0-6.627-5.373-12-12-12z" fill="${fillColor}" stroke="#ffffff" stroke-width="1.5"/><circle cx="14" cy="13" r="4" fill="#ffffff"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function pinStyle(fillColor: string, scale: number): Style {
  return new Style({ image: new Icon({ src: pinIconSrc(fillColor), anchor: [0.5, 1], scale }) });
}

let pinStyleNormal: Style | undefined;
let pinStyleHovered: Style | undefined;

/**
 * Lazily builds, then reuses, the two pin-icon `Style` instances (plain vs. hovered) — built at
 * most once each, not inside a style *function*, which OL calls per feature on every redraw, so
 * the icon's data URI is decoded into an `Image` a single time rather than on every repaint.
 * Deferred (rather than built eagerly at module load) so importing this module never constructs
 * an `Icon`/`Image` as a side effect: real construction happens only the first time OL actually
 * calls a style function, which a fully-mocked test map never does.
 */
function pinStyleFor(hovered: boolean): Style {
  if (hovered) return (pinStyleHovered ??= pinStyle(TEAL_DARK, 1.15));
  return (pinStyleNormal ??= pinStyle(TEAL, 1));
}

function clusterRadius(size: number): number {
  return size >= 50 ? 28 : size >= 10 ? 22 : 16;
}

/**
 * Cluster-mode style function: with `distance`-based clustering every point is wrapped in a
 * cluster feature, even a lone one, so "cluster of exactly one" *is* how an unclustered pin is
 * represented — it draws a single pin icon instead of a numbered circle. `hoveredRef` is read live
 * (not captured once) so the closure stays correct across hover changes without recreating the
 * layer; pair with a `.changed()` call on the layer to force a re-style when it updates.
 */
function clusterStyleFn(hoveredRef: { current: string | null }) {
  return (feature: FeatureLike) => {
    const inner = (feature.get("features") as Feature[] | undefined) ?? [];
    if (inner.length > 1) {
      return new Style({
        image: new CircleStyle({
          radius: clusterRadius(inner.length),
          fill: new Fill({ color: TEAL_CLUSTER_FILL }),
          stroke: new Stroke({ color: "#ffffff", width: 1 }),
        }),
        text: new Text({ text: String(inner.length), fill: new Fill({ color: "#ffffff" }), font: "600 12px sans-serif" }),
      });
    }
    const hovered = inner[0]?.getId() === hoveredRef.current;
    return pinStyleFor(hovered);
  };
}

/** Single-marker mode style: the marker point is a teal pin icon; the optional radius feature
 * (a `Circle` geometry, told apart from the point by geometry type) is a translucent teal fill. */
function singleMarkerStyleFn(feature: FeatureLike) {
  if (feature.getGeometry() instanceof CircleGeom) {
    return new Style({ fill: new Fill({ color: TEAL_RADIUS_FILL }), stroke: new Stroke({ color: TEAL, width: 1.5 }) });
  }
  return pinStyleFor(false);
}

/** Cluster mode: replace the raw (pre-cluster) source's features to match `points` — the OL
 * equivalent of `setData` on a GeoJSON source. The `Cluster` source wrapping it listens for this
 * and re-clusters automatically. */
function syncClusterPoints(source: VectorSource<Feature>, points: MapPoint[]) {
  source.clear();
  source.addFeatures(
    points.map((p) => {
      const feature = new Feature({ geometry: new Point(fromLonLat([p.lon, p.lat])) });
      feature.setId(p.id);
      feature.set("label", p.label ?? "");
      return feature;
    }),
  );
}

/** Single-marker mode: move-or-create the one marker feature, and add/update/remove the optional
 * radius circle (cleared outright on a set -> null/0 transition instead of left stale). */
function syncSingleMarker(source: VectorSource<Feature>, point: MapPoint | undefined, radiusMeters: number | null | undefined) {
  if (!point) return;
  const center = fromLonLat([point.lon, point.lat]);
  const marker = source.getFeatureById(point.id);
  if (marker) (marker.getGeometry() as Point | undefined)?.setCoordinates(center);
  else {
    const next = new Feature({ geometry: new Point(center) });
    next.setId(point.id);
    source.addFeature(next);
  }

  const existingRadius = source.getFeatureById(RADIUS_FEATURE_ID);
  if (!radiusMeters) {
    if (existingRadius) source.removeFeature(existingRadius);
    return;
  }
  // Circle geometries live in the map projection (EPSG:3857): the radius needs the Web Mercator
  // secant-scale correction, or a circle drawn away from the equator would render too large.
  const projectedRadius = radiusMeters / Math.cos((point.lat * Math.PI) / 180);
  if (existingRadius) (existingRadius.getGeometry() as CircleGeom | undefined)?.setCenterAndRadius(center, projectedRadius);
  else {
    const radiusFeature = new Feature({ geometry: new CircleGeom(center, projectedRadius) });
    radiusFeature.setId(RADIUS_FEATURE_ID);
    source.addFeature(radiusFeature);
  }
}

/** Thin OpenLayers wrapper over OSM raster tiles: `singleMarker` renders one marker (+ optional
 * radius circle) mini-map; otherwise renders a clustered point map, even for a single point. */
export function MapView({ points = [], center, zoom, radiusMeters = null, onPinClick, onBoundsChange, hoveredId = null, singleMarker = false, className, renderPopup }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<OlMap | null>(null);
  const overlayRef = useRef<Overlay | null>(null);
  const vectorSourceRef = useRef<VectorSource<Feature> | null>(null);
  // `any`: cluster mode's layer wraps a `Cluster` source, single-marker mode's wraps a plain
  // `VectorSource` — two different `VectorLayer<...>` generic instantiations. Only `.changed()`
  // is ever called through this ref, which doesn't depend on the source's type.
  const vectorLayerRef = useRef<VectorLayer<any> | null>(null);
  const hoveredRef = useRef<string | null>(hoveredId);
  // `singleMarker` is fixed per instance (never toggled at runtime), so this closure value
  // stays valid for the lifetime of the mount effect below — no 1-vs-many boundary to cross.
  const single = singleMarker;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const latest = useRef({ points, radiusMeters, onPinClick, onBoundsChange, renderPopup });
  latest.current = { points, radiusMeters, onPinClick, onBoundsChange, renderPopup };

  /** Clears the selection and hides the popup overlay (an `Overlay` with no position is hidden
   * by OpenLayers) — shared by the popup's own close button and by a click that hits no pin. */
  function closePopup() {
    setSelectedId(null);
    overlayRef.current?.setPosition(undefined);
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let map: OlMap | null = null;
    let resizeObserver: ResizeObserver | null = null;
    // React StrictMode (dev) runs effects mount -> cleanup -> mount synchronously. Unlike
    // MapLibre's WebGL canvas, OpenLayers' Canvas 2D map tears down and rebuilds cleanly either
    // way — this one-frame defer is now just cheap belt-and-suspenders, not a load-bearing fix.
    const raf = requestAnimationFrame(() => {
      const first = latest.current.points[0];
      const initialCenter = center ?? (single && first ? ([first.lon, first.lat] as [number, number]) : TASHKENT_CENTER);

      const osmSource = new OSM();
      osmSource.on("tileloaderror", () => console.error("[MapView] tile load error"));

      const rawSource = new VectorSource<Feature>();
      vectorSourceRef.current = rawSource;

      let overlayLayer: VectorLayer<any>; // see vectorLayerRef above re: the `any`
      if (single) {
        overlayLayer = new VectorLayer({ source: rawSource, style: singleMarkerStyleFn });
      } else {
        overlayLayer = new VectorLayer({ source: new Cluster({ distance: 44, source: rawSource }), style: clusterStyleFn(hoveredRef) });
      }
      vectorLayerRef.current = overlayLayer;

      const m = new OlMap({
        target: container,
        controls: defaultControls(),
        layers: [new TileLayer({ source: osmSource }), overlayLayer],
        view: new View({ center: fromLonLat(initialCenter), zoom: zoom ?? (single ? 15 : 12) }),
      });
      map = m;
      mapRef.current = m;
      m.updateSize();

      // The click-popup overlay: created unconditionally (cheap, and inert in single-marker
      // mode, which registers no click handler below and so never positions it) so its element
      // is already attached to the map by the time any caller's `renderPopup` needs it.
      const popupOverlay = new Overlay({
        element: popupRef.current ?? undefined,
        positioning: "bottom-center",
        offset: [0, -40],
        stopEvent: true,
      });
      m.addOverlay(popupOverlay);
      overlayRef.current = popupOverlay;

      m.on("moveend", () => {
        const size = m.getSize();
        if (!size) return;
        // `Extent` is typed as a plain `number[]`, so cast to the tuple it always actually is
        // (`[minX, minY, maxX, maxY]`) rather than fighting `noUncheckedIndexedAccess` on every index.
        const [minX, minY, maxX, maxY] = m.getView().calculateExtent(size) as [number, number, number, number];
        // `toLonLat` also returns a plain `number[]` (`Coordinate`) — same cast, same reason.
        const [minLon, minLat] = toLonLat([minX, minY]) as [number, number];
        const [maxLon, maxLat] = toLonLat([maxX, maxY]) as [number, number];
        latest.current.onBoundsChange?.({ minLat, minLon, maxLat, maxLon });
      });

      if (!single) {
        m.on("click", (e) => {
          const hit = m.forEachFeatureAtPixel(e.pixel, (feature) => {
            const inner = feature.get("features") as Feature[] | undefined;
            if (!inner) return false;
            if (inner.length === 1) {
              const id = inner[0]?.getId();
              if (typeof id === "string") {
                if (latest.current.renderPopup) {
                  setSelectedId(id);
                  overlayRef.current?.setPosition((feature.getGeometry() as Point).getCoordinates());
                } else {
                  latest.current.onPinClick?.(id);
                }
              }
              return true;
            }
            m.getView().fit(boundingExtent(inner.map((f) => (f.getGeometry() as Point).getCoordinates())), { duration: 300, maxZoom: 16 });
            return true;
          });
          // A click that hit nothing (empty map) closes any open popup instead of leaving it
          // stranded over wherever the map used to be centered.
          if (!hit) closePopup();
        });
      }

      resizeObserver = new ResizeObserver(() => m.updateSize());
      resizeObserver.observe(container);

      // OpenLayers has no MapLibre-style "load" gate — a source can be populated the instant
      // it's created — so the initial sync happens right here. The props-sync effect below is a
      // no-op on this same initial render (the ref above is still null until this rAF runs) and
      // takes over for every subsequent points/radius change.
      if (single) syncSingleMarker(rawSource, latest.current.points[0], latest.current.radiusMeters);
      else syncClusterPoints(rawSource, latest.current.points);
    });

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      map?.setTarget(undefined);
      mapRef.current = null;
      vectorSourceRef.current = null;
      vectorLayerRef.current = null;
      overlayRef.current = null;
    };
  }, []); // map is created once, on mount; props sync via the effects below (refs keep them fresh)

  useEffect(() => {
    const source = vectorSourceRef.current;
    if (!source) return;
    if (single) syncSingleMarker(source, points[0], radiusMeters);
    else syncClusterPoints(source, points);
  }, [points, radiusMeters, single]);

  useEffect(() => {
    const view = mapRef.current?.getView();
    if (!view) return;
    if (center) view.setCenter(fromLonLat(center));
    if (zoom != null) view.setZoom(zoom);
  }, [center, zoom]);

  useEffect(() => {
    hoveredRef.current = hoveredId;
    // OpenLayers has no MapLibre-style feature-state — re-styling on hover means forcing the
    // layer to re-run its style function, which reads the ref above.
    if (!single) vectorLayerRef.current?.changed();
  }, [hoveredId, single]);

  return (
    <div ref={containerRef} className={className ?? "h-full w-full min-h-64 rounded-card"}>
      {/* Nested inside the map's own container div (rather than a sibling of it) because
          OpenLayers physically moves this node into its internal overlay container once the
          `Overlay` above attaches to the map — staying a descendant of `containerRef` the whole
          time means unmounting only ever has to detach that one outer div. */}
      <div ref={popupRef}>{selectedId && renderPopup?.(selectedId, closePopup)}</div>
    </div>
  );
}
