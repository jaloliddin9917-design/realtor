import { render } from "@testing-library/react";
import { expect, test, vi } from "vitest";

// maplibre-gl needs WebGL, which jsdom doesn't have — mock it so no real map is constructed.
// NOTE: maplibre-gl (^6) ships only named exports (no `default`), verified against the
// installed package — see MapView.tsx for the corresponding named import.
const addControl = vi.fn();
const on = vi.fn();
const remove = vi.fn();
const setData = vi.fn();
// vi.fn() mocks are invoked with `new` (Map, Marker) — that requires a real `function`
// implementation, since arrow functions have no [[Construct]] and vitest's spy wrapper
// forwards the `new` call straight through to whatever implementation it wraps.
vi.mock("maplibre-gl", () => ({
  Map: vi.fn(function Map() {
    return {
      addControl,
      on,
      remove,
      getSource: () => ({ setData, getClusterExpansionZoom: vi.fn() }),
      addSource: vi.fn(),
      addLayer: vi.fn(),
      setCenter: vi.fn(),
      setZoom: vi.fn(),
      setFeatureState: vi.fn(),
      getBounds: () => ({ getSouth: () => 0, getWest: () => 0, getNorth: () => 0, getEast: () => 0 }),
    };
  }),
  NavigationControl: vi.fn(),
  Marker: vi.fn(function Marker() {
    return { setLngLat: () => ({ addTo: vi.fn() }), remove: vi.fn() };
  }),
}));

test("MapView constructs a maplibre map", async () => {
  const { MapView } = await import("./MapView");
  const { container } = render(<MapView points={[{ id: "p1", lat: 41.3, lon: 69.2 }]} />);
  const maplibre = await import("maplibre-gl");
  expect(maplibre.Map).toHaveBeenCalled();
  expect(container.querySelector("div")).toBeTruthy();
});

test("MapView renders a cluster map with multiple points and forwards pin clicks", async () => {
  const { MapView } = await import("./MapView");
  const onPinClick = vi.fn();
  const points = [
    { id: "p1", lat: 41.3, lon: 69.2, label: "One" },
    { id: "p2", lat: 41.31, lon: 69.21 },
  ];
  render(<MapView points={points} onPinClick={onPinClick} hoveredId="p2" className="test-class" />);
  const maplibre = await import("maplibre-gl");
  expect(maplibre.Map).toHaveBeenCalled();
  // cluster mode wires click handlers on the cluster + unclustered-point layers
  expect(on).toHaveBeenCalledWith("click", expect.any(String), expect.any(Function));
});
