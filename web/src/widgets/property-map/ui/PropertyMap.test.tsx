import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { allSettled, fork } from "effector";
import { Provider } from "effector-react";
import { createMemoryHistory } from "history";
import { beforeEach, expect, test, vi } from "vitest";
import type { Mock } from "vitest";
import { $pins, type Pin } from "@/entities/property";
import { $bounds, $searchArea, hovered } from "@/features/property/filters";
import { i18nReady } from "@/shared/i18n";
import { router, routes } from "@/shared/router";

// OpenLayers renders to a real <canvas>, which jsdom can't paint — mock it so no real map is
// constructed. Trimmed copy of the mock in shared/ui/map/MapView.test.tsx (cluster mode only —
// PropertyMap never passes `singleMarker`), kept local since that file exports none of it. Every
// ol/* submodule MapView.tsx imports still needs a stub here too, even ones this file's own
// scenarios never exercise (e.g. `ol/geom/Circle`), since those imports run unconditionally.
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

const getSize = vi.fn(() => [800, 600]);
const calculateExtent = vi.fn(() => [2, 1, 4, 3]);
const fit = vi.fn();
const changed = vi.fn();
const forEachFeatureAtPixel = vi.fn();
const mockView = { calculateExtent, fit, setCenter: vi.fn(), setZoom: vi.fn() };

const clear = vi.fn(() => { features = []; });
const addFeature = vi.fn((f: MockFeature) => { features.push(f); });
const addFeatures = vi.fn((fs: MockFeature[]) => { features.push(...fs); });
const removeFeature = vi.fn((f: MockFeature) => { features = features.filter((x) => x !== f); });
const getFeatureById = vi.fn((id: string) => features.find((f) => f.getId() === id) ?? null);
const getFeatures = vi.fn(() => features);

const on = vi.fn((type: string, cb: Handler) => {
  handlers[type] = cb;
});

vi.mock("ol/Map", () => ({
  default: vi.fn(function MockMap() {
    handlers = {};
    return { on, forEachFeatureAtPixel, getSize, getView: () => mockView, updateSize: vi.fn(), setTarget: vi.fn() };
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
    return { getCenter: () => center, getRadius: () => radius, setCenterAndRadius: vi.fn() };
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

function getHandler(key: string): Handler {
  const handler = handlers[key];
  if (!handler) throw new Error(`no "${key}" handler recorded; got: ${Object.keys(handlers).join(", ") || "(none)"}`);
  return handler;
}

/** Waits for the lazily-imported MapView to mount its (mocked) OpenLayers map. */
async function waitForMap() {
  const { default: OlMap } = await import("ol/Map");
  await waitFor(() => expect(OlMap).toHaveBeenCalled());
}

const PIN_A: Pin = { id: "p1", latitude: 41.3, longitude: 69.2, price_usd_min_minor: 45000, rooms: 2, status: "active", source_removed: false };
const PIN_B: Pin = { id: "p2", latitude: 41.31, longitude: 69.21, price_usd_min_minor: 80000, rooms: 3, status: "new", source_removed: false };

async function mount(pins: Pin[] = [PIN_A, PIN_B]) {
  const { PropertyMap } = await import("./PropertyMap");
  const scope = fork({ values: [[$pins, pins]] });
  await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/properties"] }) });
  render(<Provider value={scope}><PropertyMap /></Provider>);
  return scope;
}

beforeAll(() => i18nReady);
beforeEach(() => {
  vi.clearAllMocks();
});

test("renders the pins as map points once the lazily-loaded map mounts", async () => {
  await mount();
  await waitForMap();

  expect(getFeatures().map((f) => f.getId())).toEqual(["p1", "p2"]);
  expect(getFeatures().map((f) => f.get("label"))).toEqual(["$450", "$800"]);
});

test("clicking a pin navigates straight to that property", async () => {
  const scope = await mount();
  await waitForMap();

  // OL's `Cluster` source wraps every point in a cluster feature, even a lone one — a "cluster"
  // of exactly one underlying feature is how an unclustered pin actually renders/hit-tests.
  const innerFeature = { getId: () => "p1" };
  forEachFeatureAtPixel.mockImplementation((_pixel: unknown, cb: (f: unknown) => unknown) =>
    cb({ get: (key: string) => (key === "features" ? [innerFeature] : undefined) }),
  );
  getHandler("click")({ pixel: [10, 10] });

  await waitFor(() => expect(scope.getState(routes.property.$isOpened)).toBe(true));
  expect(scope.getState(routes.property.$params)).toEqual({ id: "p1" });
});

test("the search-this-area switch toggles $searchArea", async () => {
  const scope = await mount();
  expect(scope.getState($searchArea)).toBe("");

  await userEvent.click(screen.getByRole("switch", { name: "Bu hududda qidirish" }));

  await waitFor(() => expect(scope.getState($searchArea)).toBe("1"));
});

test("panning the map feeds the new viewport into $bounds", async () => {
  const scope = await mount();
  await waitForMap();

  getHandler("moveend")();

  await waitFor(() => expect(scope.getState($bounds)).toEqual({ minLat: 1, minLon: 2, maxLat: 3, maxLon: 4 }));
});

test("forwards $hoveredId into the map so the matching pin glows", async () => {
  const scope = await mount();
  await waitForMap();
  // the mount-time hover-sync effect already calls `changed()` once (for the initial, unset
  // hoveredId) — clear that so the assertion below actually proves the *update* triggered it.
  changed.mockClear();

  // the hover store update re-renders PropertyMap outside of any user-event/RTL helper, so it
  // must be wrapped explicitly to keep React's act() warning quiet
  await act(async () => { await allSettled(hovered, { scope, params: "p1" }); });

  // OpenLayers has no MapLibre-style feature-state — re-styling on hover means forcing the
  // vector layer to re-run its style function, which is what makes the matching pin glow.
  await waitFor(() => expect(changed).toHaveBeenCalled());
});

test("shows the no-coordinates state once pins have loaded empty", async () => {
  await mount([]);
  expect(await screen.findByText("Koordinatalar yo'q")).toBeInTheDocument();
});
