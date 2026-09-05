import { render } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { Mock } from "vitest";

// OpenLayers renders to a real <canvas>, which jsdom can't paint — mock every ol/* submodule
// MapView.tsx imports so no real map, tiles, or canvas rendering is ever attempted.
//
// A mocked VectorLayer never actually calls its `style` function (that only happens inside OL's
// real canvas renderer), so style-function output isn't something these tests can observe. What
// they track instead is the state MapView.tsx itself manages: the raw (pre-cluster) VectorSource's
// features (via hoisted `addFeature(s)`/`removeFeature`/`getFeatureById`/`getFeatures` spies,
// reset whenever a new mock source is constructed — i.e. on every render()) and the Map's
// registered event handlers (`handlers`, reset whenever a new mock map is constructed) — enough
// to exercise MapView's own sync/click/bounds logic rather than merely asserting construction.

type Handler = (arg?: unknown) => void;
interface MockFeature {
  setId: Mock;
  getId: Mock;
  getGeometry: Mock;
  setGeometry: Mock;
  get: Mock;
  set: Mock;
}

let handlers: Record<string, Handler> = {};
let features: MockFeature[] = [];

const updateSize = vi.fn();
const setTarget = vi.fn();
const getSize = vi.fn(() => [800, 600]);
const calculateExtent = vi.fn(() => [0, 0, 0, 0]);
const fit = vi.fn();
const setCenter = vi.fn();
const setZoom = vi.fn();
const forEachFeatureAtPixel = vi.fn();
const changed = vi.fn();
const mockView = { calculateExtent, fit, setCenter, setZoom };

const clear = vi.fn(() => { features = []; });
const addFeature = vi.fn((f: MockFeature) => { features.push(f); });
const addFeatures = vi.fn((fs: MockFeature[]) => { features.push(...fs); });
const removeFeature = vi.fn((f: MockFeature) => { features = features.filter((x) => x !== f); });
const getFeatureById = vi.fn((id: string) => features.find((f) => f.getId() === id) ?? null);
const getFeatures = vi.fn(() => features);

const on = vi.fn((type: string, cb: Handler) => {
  handlers[type] = cb;
});

// vi.fn() mocks are invoked with `new` (Map, Feature, ...) — that requires a real `function`
// implementation, since arrow functions have no [[Construct]] and vitest's spy wrapper forwards
// the `new` call straight through to whatever implementation it wraps.
vi.mock("ol/Map", () => ({
  default: vi.fn(function MockMap() {
    handlers = {};
    return { on, forEachFeatureAtPixel, getSize, getView: () => mockView, updateSize, setTarget };
  }),
}));
vi.mock("ol/View", () => ({ default: vi.fn(function MockView(opts: unknown) { return opts; }) }));
vi.mock("ol/layer/Tile", () => ({ default: vi.fn(function MockTileLayer() { return {}; }) }));
vi.mock("ol/source/OSM", () => ({ default: vi.fn(function MockOSM() { return { on: vi.fn() }; }) }));
vi.mock("ol/layer/Vector", () => ({ default: vi.fn(function MockVectorLayer() { return { changed }; }) }));
vi.mock("ol/source/Vector", () => ({
  default: vi.fn(function MockVectorSource() {
    features = [];
    return { clear, addFeature, addFeatures, removeFeature, getFeatureById, getFeatures };
  }),
}));
vi.mock("ol/source/Cluster", () => ({ default: vi.fn(function MockCluster(opts: unknown) { return opts; }) }));
vi.mock("ol/Feature", () => ({
  default: vi.fn(function MockFeatureCtor(opts?: { geometry?: unknown }) {
    let id: string | number | undefined;
    let geometry = opts?.geometry;
    const props: Record<string, unknown> = {};
    const feature: MockFeature = {
      setId: vi.fn((v: string | number | undefined) => { id = v; }),
      getId: vi.fn(() => id),
      getGeometry: vi.fn(() => geometry),
      setGeometry: vi.fn((g: unknown) => { geometry = g; }),
      get: vi.fn((key: string) => props[key]),
      set: vi.fn((key: string, value: unknown) => { props[key] = value; }),
    };
    return feature;
  }),
}));
vi.mock("ol/geom/Point", () => ({
  default: vi.fn(function MockPoint(coordinates: [number, number]) {
    let c = coordinates;
    return { getCoordinates: () => c, setCoordinates: (next: [number, number]) => { c = next; } };
  }),
}));
vi.mock("ol/geom/Circle", () => ({
  default: vi.fn(function MockCircleGeom(center: [number, number], radius: number) {
    let r = radius;
    return { getCenter: () => center, getRadius: () => r, setCenterAndRadius: vi.fn((_c: unknown, nextRadius: number) => { r = nextRadius; }) };
  }),
}));
vi.mock("ol/proj", () => ({
  fromLonLat: vi.fn((c: [number, number]) => c),
  toLonLat: vi.fn((c: [number, number]) => c),
}));
vi.mock("ol/style", () => ({
  Style: vi.fn(() => ({})),
  Fill: vi.fn(() => ({})),
  Stroke: vi.fn(() => ({})),
  Circle: vi.fn(() => ({})),
  Text: vi.fn(() => ({})),
}));
vi.mock("ol/control/defaults", () => ({ defaults: vi.fn(() => []) }));

/** Fetches a handler MapView registered via `map.on(...)`; throws with what *was* recorded if missing. */
function getHandler(key: string): Handler {
  const handler = handlers[key];
  if (!handler) throw new Error(`no "${key}" handler recorded; got: ${Object.keys(handlers).join(", ") || "(none)"}`);
  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("MapView constructs an OpenLayers map", async () => {
  const { MapView } = await import("./MapView");
  const { container } = render(<MapView points={[{ id: "p1", lat: 41.3, lon: 69.2 }]} />);
  const { default: OlMap } = await import("ol/Map");
  expect(OlMap).toHaveBeenCalled();
  expect(container.querySelector("div")).toBeTruthy();
});

test("MapView applies the given className to its container div", async () => {
  const { MapView } = await import("./MapView");
  const { container } = render(<MapView points={[]} className="test-class" />);
  expect(container.querySelector("div.test-class")).toBeTruthy();
});

test("cluster mode (default) wraps the raw source in a Cluster and syncs points into it", async () => {
  const { MapView } = await import("./MapView");
  const points = [
    { id: "p1", lat: 41.3, lon: 69.2, label: "One" },
    { id: "p2", lat: 41.31, lon: 69.21 },
  ];
  render(<MapView points={points} />);

  const { default: Cluster } = await import("ol/source/Cluster");
  expect(Cluster).toHaveBeenCalledWith(expect.objectContaining({ distance: 44 }));
  expect(addFeatures).toHaveBeenCalled();
  expect(getFeatures().map((f) => f.getId())).toEqual(["p1", "p2"]);
  expect(getFeatures().map((f) => f.get("label"))).toEqual(["One", ""]);
});

test("single-marker mode adds a radius feature, then clears it once radiusMeters goes null", async () => {
  const { MapView } = await import("./MapView");
  const point = { id: "p1", lat: 41.3, lon: 69.2 };
  const { rerender } = render(<MapView points={[point]} singleMarker radiusMeters={300} />);

  expect(getFeatureById("p1")).toBeTruthy();
  // "__radius__" mirrors RADIUS_FEATURE_ID in MapView.tsx (not exported — this assertion is
  // deliberately implementation-aware).
  expect(getFeatureById("__radius__")).toBeTruthy();

  rerender(<MapView points={[point]} singleMarker radiusMeters={null} />);

  expect(getFeatureById("__radius__")).toBeNull();
});

test("cluster mode forwards a click on an unclustered pin to onPinClick", async () => {
  const { MapView } = await import("./MapView");
  const onPinClick = vi.fn();
  const points = [
    { id: "p1", lat: 41.3, lon: 69.2 },
    { id: "p2", lat: 41.31, lon: 69.21 },
  ];
  render(<MapView points={points} onPinClick={onPinClick} />);

  // OL's `Cluster` source wraps every point in a cluster feature, even a lone one — a "cluster"
  // of exactly one underlying feature is how an unclustered pin actually renders/hit-tests.
  const innerFeature = { getId: () => "p1" };
  forEachFeatureAtPixel.mockImplementation((_pixel: unknown, cb: (f: unknown) => unknown) =>
    cb({ get: (key: string) => (key === "features" ? [innerFeature] : undefined) }),
  );

  getHandler("click")({ pixel: [10, 10] });

  expect(onPinClick).toHaveBeenCalledWith("p1");
  expect(onPinClick).toHaveBeenCalledTimes(1);
});

test("cluster mode zooms to fit the cluster when a multi-pin cluster is clicked", async () => {
  const { MapView } = await import("./MapView");
  const points = [
    { id: "p1", lat: 41.3, lon: 69.2 },
    { id: "p2", lat: 41.4, lon: 69.3 },
  ];
  render(<MapView points={points} />);

  const innerFeatures = [
    { getId: () => "p1", getGeometry: () => ({ getCoordinates: () => [69.2, 41.3] }) },
    { getId: () => "p2", getGeometry: () => ({ getCoordinates: () => [69.3, 41.4] }) },
  ];
  forEachFeatureAtPixel.mockImplementation((_pixel: unknown, cb: (f: unknown) => unknown) =>
    cb({ get: (key: string) => (key === "features" ? innerFeatures : undefined) }),
  );

  getHandler("click")({ pixel: [10, 10] });

  expect(fit).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ duration: 300, maxZoom: 16 }));
});
