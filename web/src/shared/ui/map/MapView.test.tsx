import { render } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { Mock } from "vitest";

// maplibre-gl needs WebGL, which jsdom doesn't have — mock it so no real map is constructed.
// NOTE: maplibre-gl (^6) ships only named exports (no `default`), verified against the
// installed package — see MapView.tsx for the corresponding named import.
//
// The mock tracks enough state to actually exercise MapView instead of just asserting
// `new Map()` happened:
//  - `on(type, layerOrCb, cb?)` records every handler the component registers, keyed by
//    "type" (2-arg form, e.g. "load") or "type:layer" (3-arg form, e.g. "click:rp-point"), so
//    tests can invoke them the way MapLibre would once tiles/data actually load.
//  - `addSource`/`removeSource`/`getSource` and `addLayer`/`removeLayer`/`getLayer` share a
//    small in-memory registry so `getSource`/`getLayer` correctly reflect prior add/remove
//    calls within a test — MapView relies on that existence check to decide whether to create
//    the radius source/layer or reuse/clear it.
// Both registries reset whenever a new mock Map is constructed (i.e. on every render()), so
// tests stay isolated even though the underlying `vi.fn()`s live at module scope.

type Handler = (arg?: unknown) => void;
interface MockSource {
  setData: Mock;
  getClusterExpansionZoom: Mock;
}

let handlers: Record<string, Handler> = {};
let sources = new Map<string, MockSource>();
let layers = new Set<string>();

const addControl = vi.fn();
const off = vi.fn();
const remove = vi.fn();
const setCenter = vi.fn();
const setZoom = vi.fn();
const setFeatureState = vi.fn();
const easeTo = vi.fn();
const queryRenderedFeatures = vi.fn();
const getBounds = vi.fn(() => ({ getSouth: () => 0, getWest: () => 0, getNorth: () => 0, getEast: () => 0 }));

const on = vi.fn((type: string, layerOrCb: unknown, cb?: Handler) => {
  if (typeof layerOrCb === "function") handlers[type] = layerOrCb as Handler;
  else if (typeof layerOrCb === "string" && typeof cb === "function") handlers[`${type}:${layerOrCb}`] = cb;
});

const addSource = vi.fn((id: string) => {
  sources.set(id, { setData: vi.fn(), getClusterExpansionZoom: vi.fn().mockResolvedValue(10) });
});
const removeSource = vi.fn((id: string) => {
  sources.delete(id);
});
const getSource = vi.fn((id: string) => sources.get(id));

const addLayer = vi.fn((layer: { id: string }) => {
  layers.add(layer.id);
});
const removeLayer = vi.fn((id: string) => {
  layers.delete(id);
});
const getLayer = vi.fn((id: string) => (layers.has(id) ? { id } : undefined));

// vi.fn() mocks are invoked with `new` (Map, Marker) — that requires a real `function`
// implementation, since arrow functions have no [[Construct]] and vitest's spy wrapper
// forwards the `new` call straight through to whatever implementation it wraps.
vi.mock("maplibre-gl", () => ({
  // Named `MockMap`, not `Map` — a same-named function expression shadows the global `Map`
  // class inside its own body, which would turn `new Map()` below into infinite self-recursion.
  Map: vi.fn(function MockMap() {
    handlers = {};
    sources = new Map();
    layers = new Set();
    return {
      addControl, on, off, remove,
      getSource, addSource, removeSource,
      getLayer, addLayer, removeLayer,
      setCenter, setZoom, setFeatureState, easeTo, queryRenderedFeatures, getBounds, resize: vi.fn(),
    };
  }),
  NavigationControl: vi.fn(),
  Marker: vi.fn(function Marker() {
    const marker = { setLngLat: vi.fn(() => marker), addTo: vi.fn(() => marker), remove: vi.fn() };
    return marker;
  }),
}));

/** Fetches a handler MapView registered via `map.on(...)`; throws with what *was* recorded if missing. */
function getHandler(key: string): Handler {
  const handler = handlers[key];
  if (!handler) throw new Error(`no "${key}" handler recorded; got: ${Object.keys(handlers).join(", ") || "(none)"}`);
  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("MapView constructs a maplibre map", async () => {
  const { MapView } = await import("./MapView");
  const { container } = render(<MapView points={[{ id: "p1", lat: 41.3, lon: 69.2 }]} />);
  const maplibre = await import("maplibre-gl");
  expect(maplibre.Map).toHaveBeenCalled();
  expect(container.querySelector("div")).toBeTruthy();
});

test("MapView applies the given className to its container div", async () => {
  const { MapView } = await import("./MapView");
  const { container } = render(<MapView points={[]} className="test-class" />);
  expect(container.querySelector("div.test-class")).toBeTruthy();
});

test("cluster mode (default) adds the source/layers on load and syncs points via setData", async () => {
  const { MapView } = await import("./MapView");
  const points = [
    { id: "p1", lat: 41.3, lon: 69.2, label: "One" },
    { id: "p2", lat: 41.31, lon: 69.21 },
  ];
  render(<MapView points={points} />);

  getHandler("load")();

  // "rp-points" / "rp-point" mirror MapView.tsx's internal SOURCE_ID / POINT_LAYER constants
  // (not exported — this assertion is deliberately implementation-aware).
  expect(addSource).toHaveBeenCalledWith("rp-points", expect.objectContaining({ type: "geojson", cluster: true }));
  expect(addLayer).toHaveBeenCalled();

  const pointsSource = sources.get("rp-points");
  expect(pointsSource?.setData).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "FeatureCollection",
      features: [
        expect.objectContaining({ properties: expect.objectContaining({ pointId: "p1" }) }),
        expect.objectContaining({ properties: expect.objectContaining({ pointId: "p2" }) }),
      ],
    }),
  );
});

test("single-marker mode adds a radius layer, then clears it once radiusMeters goes null", async () => {
  const { MapView } = await import("./MapView");
  const point = { id: "p1", lat: 41.3, lon: 69.2 };
  const { rerender } = render(<MapView points={[point]} singleMarker radiusMeters={300} />);

  getHandler("load")();

  // "rp-radius" / "rp-radius-fill" mirror RADIUS_SOURCE_ID / RADIUS_LAYER in MapView.tsx.
  expect(addSource).toHaveBeenCalledWith("rp-radius", expect.objectContaining({ type: "geojson" }));
  expect(addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "rp-radius-fill" }));
  expect(sources.has("rp-radius")).toBe(true);
  expect(layers.has("rp-radius-fill")).toBe(true);

  rerender(<MapView points={[point]} singleMarker radiusMeters={null} />);

  expect(removeLayer).toHaveBeenCalledWith("rp-radius-fill");
  expect(removeSource).toHaveBeenCalledWith("rp-radius");
  expect(sources.has("rp-radius")).toBe(false);
  expect(layers.has("rp-radius-fill")).toBe(false);
});

test("cluster mode forwards a point-layer click to onPinClick", async () => {
  const { MapView } = await import("./MapView");
  const onPinClick = vi.fn();
  const points = [
    { id: "p1", lat: 41.3, lon: 69.2 },
    { id: "p2", lat: 41.31, lon: 69.21 },
  ];
  render(<MapView points={points} onPinClick={onPinClick} />);
  getHandler("load")();

  // "rp-point" mirrors POINT_LAYER in MapView.tsx; the handler reads `properties.pointId`.
  getHandler("click:rp-point")({ features: [{ properties: { pointId: "p1" } }] });

  expect(onPinClick).toHaveBeenCalledWith("p1");
  expect(onPinClick).toHaveBeenCalledTimes(1);
});
