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

// maplibre-gl needs WebGL, which jsdom doesn't have — mock it so no real map is constructed.
// Trimmed copy of the mock in shared/ui/map/MapView.test.tsx (cluster mode only — PropertyMap
// never passes `singleMarker`), kept local since that file exports none of it.
type Handler = (arg?: unknown) => void;
interface MockSource { setData: Mock }

let handlers: Record<string, Handler> = {};
let sources = new Map<string, MockSource>();
let layers = new Set<string>();

const addControl = vi.fn();
const off = vi.fn();
const remove = vi.fn();
const setFeatureState = vi.fn();
const easeTo = vi.fn();
const getBounds = vi.fn(() => ({ getSouth: () => 1, getWest: () => 2, getNorth: () => 3, getEast: () => 4 }));

const on = vi.fn((type: string, layerOrCb: unknown, cb?: Handler) => {
  if (typeof layerOrCb === "function") handlers[type] = layerOrCb as Handler;
  else if (typeof layerOrCb === "string" && typeof cb === "function") handlers[`${type}:${layerOrCb}`] = cb;
});
const addSource = vi.fn((id: string) => { sources.set(id, { setData: vi.fn() }); });
const removeSource = vi.fn((id: string) => { sources.delete(id); });
const getSource = vi.fn((id: string) => sources.get(id));
const addLayer = vi.fn((layer: { id: string }) => { layers.add(layer.id); });
const removeLayer = vi.fn((id: string) => { layers.delete(id); });
const getLayer = vi.fn((id: string) => (layers.has(id) ? { id } : undefined));

vi.mock("maplibre-gl", () => ({
  Map: vi.fn(function MockMap() {
    handlers = {};
    sources = new Map();
    layers = new Set();
    return {
      addControl, on, off, remove,
      getSource, addSource, removeSource,
      getLayer, addLayer, removeLayer,
      setFeatureState, easeTo, getBounds, resize: vi.fn(),
      setCenter: vi.fn(), setZoom: vi.fn(), queryRenderedFeatures: vi.fn(),
    };
  }),
  NavigationControl: vi.fn(),
  Marker: vi.fn(function Marker() {
    const marker = { setLngLat: vi.fn(() => marker), addTo: vi.fn(() => marker), remove: vi.fn() };
    return marker;
  }),
}));

function getHandler(key: string): Handler {
  const handler = handlers[key];
  if (!handler) throw new Error(`no "${key}" handler recorded; got: ${Object.keys(handlers).join(", ") || "(none)"}`);
  return handler;
}

/** Waits for the lazily-imported MapView to mount its (mocked) maplibre map. */
async function waitForMap() {
  const maplibre = await import("maplibre-gl");
  await waitFor(() => expect(maplibre.Map).toHaveBeenCalled());
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
  getHandler("load")();

  const source = sources.get("rp-points");
  expect(source?.setData).toHaveBeenCalledWith(
    expect.objectContaining({
      features: [
        expect.objectContaining({ properties: expect.objectContaining({ pointId: "p1", label: "$450" }) }),
        expect.objectContaining({ properties: expect.objectContaining({ pointId: "p2", label: "$800" }) }),
      ],
    }),
  );
});

test("clicking a pin navigates straight to that property", async () => {
  const scope = await mount();
  await waitForMap();
  getHandler("load")();

  getHandler("click:rp-point")({ features: [{ properties: { pointId: "p1" } }] });

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
  getHandler("load")();

  getHandler("moveend")();

  await waitFor(() => expect(scope.getState($bounds)).toEqual({ minLat: 1, minLon: 2, maxLat: 3, maxLon: 4 }));
});

test("forwards $hoveredId into the map so the matching pin glows", async () => {
  const scope = await mount();
  await waitForMap();
  getHandler("load")();

  // the hover store update re-renders PropertyMap outside of any user-event/RTL helper, so it
  // must be wrapped explicitly to keep React's act() warning quiet
  await act(async () => { await allSettled(hovered, { scope, params: "p1" }); });

  await waitFor(() => expect(setFeatureState).toHaveBeenCalledWith({ source: "rp-points", id: "p1" }, { hovered: true }));
});

test("shows the no-coordinates state once pins have loaded empty", async () => {
  await mount([]);
  expect(await screen.findByText("Koordinatalar yo'q")).toBeInTheDocument();
});
