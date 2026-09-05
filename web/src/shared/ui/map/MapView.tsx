import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { Map as MapLibreMap, Marker, NavigationControl } from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import { MAP_STYLE_URL, TASHKENT_CENTER } from "./style";

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
  /** Explicit mode switch: one Marker (+ optional radius circle) instead of the clustered GeoJSON source/layers. Fixed per instance — never toggled at runtime. Default false. */
  singleMarker?: boolean;
  className?: string;
}

// Minimal local GeoJSON shapes (not the ambient `GeoJSON` global maplibre-gl's own types assume).
interface PointFeatureCollection {
  type: "FeatureCollection";
  features: { type: "Feature"; id: string; properties: { pointId: string; label: string }; geometry: { type: "Point"; coordinates: [number, number] } }[];
}
interface RadiusFeatureCollection {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: Record<string, never>; geometry: { type: "Polygon"; coordinates: [number, number][][] } }[];
}

const SOURCE_ID = "rp-points";
const CLUSTER_LAYER = "rp-clusters";
const CLUSTER_COUNT_LAYER = "rp-cluster-count";
const POINT_LAYER = "rp-point";
const RADIUS_SOURCE_ID = "rp-radius";
const RADIUS_LAYER = "rp-radius-fill";
const TEAL = "#0f6e63";

function toFeatureCollection(points: MapPoint[]): PointFeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      id: p.id,
      properties: { pointId: p.id, label: p.label ?? "" },
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    })),
  };
}

/** Rough (non-geodesic) circle ring in degrees — good enough for a mini-map radius. */
function circleFeatureCollection(lon: number, lat: number, radiusMeters: number): RadiusFeatureCollection {
  const steps = 64;
  const latRad = (lat * Math.PI) / 180;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    ring.push([lon + (radiusMeters * Math.cos(angle)) / (111_320 * Math.cos(latRad)), lat + (radiusMeters * Math.sin(angle)) / 110_540]);
  }
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }] };
}

function addClusterLayers(map: MapLibreMap) {
  map.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterMaxZoom: 16, clusterRadius: 50 });
  map.addLayer({
    id: CLUSTER_LAYER, type: "circle", source: SOURCE_ID, filter: ["has", "point_count"],
    paint: { "circle-color": TEAL, "circle-opacity": 0.85, "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 50, 28] },
  });
  map.addLayer({
    id: CLUSTER_COUNT_LAYER, type: "symbol", source: SOURCE_ID, filter: ["has", "point_count"],
    layout: { "text-field": "{point_count_abbreviated}", "text-size": 12 }, paint: { "text-color": "#ffffff" },
  });
  map.addLayer({
    id: POINT_LAYER, type: "circle", source: SOURCE_ID, filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": ["case", ["boolean", ["feature-state", "hovered"], false], "#0b5349", TEAL],
      "circle-radius": ["case", ["boolean", ["feature-state", "hovered"], false], 9, 6],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });
}

/** Pushes points/radius into the map: single mode creates/moves a Marker (+ optional radius fill layer); cluster mode updates the GeoJSON source. */
function syncData(map: MapLibreMap, single: boolean, loaded: boolean, points: MapPoint[], radiusMeters: number | null | undefined, markerRef: { current: Marker | null }) {
  if (single) {
    const p = points[0];
    if (!p) return;
    if (markerRef.current) markerRef.current.setLngLat([p.lon, p.lat]);
    else markerRef.current = new Marker({ color: TEAL }).setLngLat([p.lon, p.lat]).addTo(map);
    if (!loaded) return;
    if (!radiusMeters) {
      // Set -> null/0 transition: erase a previously-drawn circle instead of leaving it stale.
      if (map.getLayer(RADIUS_LAYER)) map.removeLayer(RADIUS_LAYER);
      if (map.getSource(RADIUS_SOURCE_ID)) map.removeSource(RADIUS_SOURCE_ID);
      return;
    }
    const data = circleFeatureCollection(p.lon, p.lat, radiusMeters);
    const source = map.getSource<GeoJSONSource>(RADIUS_SOURCE_ID);
    if (source) source.setData(data);
    else {
      map.addSource(RADIUS_SOURCE_ID, { type: "geojson", data });
      map.addLayer({ id: RADIUS_LAYER, type: "fill", source: RADIUS_SOURCE_ID, paint: { "fill-color": TEAL, "fill-opacity": 0.12 } });
    }
    return;
  }
  if (!loaded) return;
  map.getSource<GeoJSONSource>(SOURCE_ID)?.setData(toFeatureCollection(points));
}

/** Thin MapLibre GL wrapper: `singleMarker` renders one Marker (+ optional radius circle) mini-map; otherwise renders a clustered GeoJSON map, even for a single point. */
export function MapView({ points = [], center, zoom, radiusMeters = null, onPinClick, onBoundsChange, hoveredId = null, singleMarker = false, className }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const loadedRef = useRef(false);
  const hoveredRef = useRef<string | null>(null);
  // `singleMarker` is fixed per instance (never toggled at runtime), so this closure value
  // stays valid for the lifetime of the mount effect below — no 1-vs-many boundary to cross.
  const single = singleMarker;

  const latest = useRef({ points, radiusMeters, onPinClick, onBoundsChange });
  latest.current = { points, radiusMeters, onPinClick, onBoundsChange };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const first = latest.current.points[0];
    const initialCenter = center ?? (single && first ? ([first.lon, first.lat] as [number, number]) : TASHKENT_CENTER);
    const map = new MapLibreMap({ container, style: MAP_STYLE_URL, center: initialCenter, zoom: zoom ?? (single ? 15 : 12) });
    mapRef.current = map;
    map.addControl(new NavigationControl(), "top-right");
    // surface tile/style/WebGL failures instead of silently rendering a blank canvas
    map.on("error", (e) => console.error("[MapView] map error:", (e as { error?: { message?: string } }).error?.message ?? e));
    // The map is usually created while its container is still settling — lazy-mounted behind a
    // Suspense fallback and revealed by the List/Map toggle. If MapLibre measured the box before
    // it reached its final size, the WebGL drawing buffer stays wrong and the canvas renders
    // blank even though the element is full-size. Resize on load and on every container resize so
    // the buffer always matches the box.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);

    map.on("load", () => {
      loadedRef.current = true;
      map.resize();
      if (!single) addClusterLayers(map);
      syncData(map, single, true, latest.current.points, latest.current.radiusMeters, markerRef);
    });
    map.on("moveend", () => {
      const b = map.getBounds();
      latest.current.onBoundsChange?.({ minLat: b.getSouth(), minLon: b.getWest(), maxLat: b.getNorth(), maxLon: b.getEast() });
    });
    map.on("click", CLUSTER_LAYER, (e) => {
      const feature = e.features?.[0];
      const clusterId = feature?.properties?.["cluster_id"];
      const geometry = feature?.geometry;
      const source = map.getSource<GeoJSONSource>(SOURCE_ID);
      if (source && typeof clusterId === "number" && geometry?.type === "Point") {
        const [lon, lat] = geometry.coordinates;
        source.getClusterExpansionZoom(clusterId).then((z) => map.easeTo({ center: [lon, lat], zoom: z }));
      }
    });
    map.on("click", POINT_LAYER, (e) => {
      const id = e.features?.[0]?.properties?.["pointId"];
      if (typeof id === "string") latest.current.onPinClick?.(id);
    });

    return () => {
      resizeObserver.disconnect();
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []); // map is created once, on mount; props sync via the effects below (refs keep them fresh)

  // also covers the initial sync: this runs right after the mount effect above on first render
  useEffect(() => {
    const map = mapRef.current;
    if (map) syncData(map, single, loadedRef.current, points, radiusMeters, markerRef);
  }, [points, radiusMeters, single]);

  useEffect(() => {
    if (center) mapRef.current?.setCenter(center);
    if (zoom != null) mapRef.current?.setZoom(zoom);
  }, [center, zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || single || !loadedRef.current) return;
    if (hoveredRef.current) map.setFeatureState({ source: SOURCE_ID, id: hoveredRef.current }, { hovered: false });
    if (hoveredId) map.setFeatureState({ source: SOURCE_ID, id: hoveredId }, { hovered: true });
    hoveredRef.current = hoveredId;
  }, [hoveredId, single]);

  return <div ref={containerRef} className={className ?? "h-full w-full min-h-64 rounded-card"} />;
}
