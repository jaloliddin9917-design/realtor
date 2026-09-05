import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "atomic-router-react";
import { allSettled, fork } from "effector";
import { Provider } from "effector-react";
import { createMemoryHistory } from "history";
import { $meta } from "@/entities/meta";
import { $page, $pins, type Pin, type PropertyPage, type PropertyRow } from "@/entities/property";
import { sessionRestored } from "@/entities/session";
import { $view, viewChanged } from "@/features/property/filters";
import { i18nReady } from "@/shared/i18n";
import { router } from "@/shared/router";
import { PropertiesPage } from "./ui";

// The map view mounts `PropertyMap`, which lazily loads `MapView` — OpenLayers renders to a real
// <canvas>, which jsdom can't paint, so every ol/* submodule MapView.tsx imports is mocked here
// too (trimmed copy of the mock in shared/ui/map/MapView.test.tsx and
// widgets/property-map/ui/PropertyMap.test.tsx). None of this file's assertions look at the
// map's internals, so the mock only needs to make mounting safe, not to track handlers/sources.
const mockView = { calculateExtent: vi.fn(() => [0, 0, 0, 0]), fit: vi.fn(), setCenter: vi.fn(), setZoom: vi.fn() };
vi.mock("ol/Map", () => ({
  default: vi.fn(function MockMap() {
    return { on: vi.fn(), forEachFeatureAtPixel: vi.fn(), getSize: () => [800, 600], getView: () => mockView, updateSize: vi.fn(), setTarget: vi.fn() };
  }),
}));
vi.mock("ol/View", () => ({ default: vi.fn(function MockView(opts: unknown) { return opts; }) }));
vi.mock("ol/layer/Tile", () => ({ default: vi.fn(function MockTileLayer() { return {}; }) }));
vi.mock("ol/source/OSM", () => ({ default: vi.fn(function MockOSM() { return { on: vi.fn() }; }) }));
vi.mock("ol/layer/Vector", () => ({ default: vi.fn(function MockVectorLayer() { return { changed: vi.fn() }; }) }));
vi.mock("ol/source/Vector", () => ({
  default: vi.fn(function MockVectorSource() {
    return { clear: vi.fn(), addFeature: vi.fn(), addFeatures: vi.fn(), removeFeature: vi.fn(), getFeatureById: vi.fn(), getFeatures: vi.fn(() => []) };
  }),
}));
vi.mock("ol/source/Cluster", () => ({ default: vi.fn(function MockCluster(opts: unknown) { return opts; }) }));
vi.mock("ol/Feature", () => ({
  default: vi.fn(function MockFeatureCtor() {
    return { setId: vi.fn(), getId: vi.fn(), getGeometry: vi.fn(), setGeometry: vi.fn(), get: vi.fn(), set: vi.fn() };
  }),
}));
vi.mock("ol/geom/Point", () => ({
  default: vi.fn(function MockPoint(coordinates: [number, number]) {
    return { getCoordinates: () => coordinates, setCoordinates: vi.fn() };
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

const row: PropertyRow = { id: "p1", status: "active", district: "chilonzor", rooms: 2, floor: 3, total_floors: 9, area_sqm: 54, price_usd_min_minor: 45000, source_removed: false, needs_recheck: false, first_seen_at: "2026-08-12T09:00:00Z", last_seen_at: "2026-08-29T12:40:00Z", listing_count: 2, source_kinds: ["olx", "telegram"], probable_owner: null, photo_url: null, last_status_event: null, latitude: null, longitude: null, location_radius_m: null, location_label: null, building_type: null, is_furnished: null, renovation: null, year_built: null };

async function mount(opts: { page?: PropertyPage; pins?: Pin[]; view?: "list" | "map" } = {}) {
  const scope = fork({
    values: [
      [$page, opts.page ?? { items: [row], total: 42, page: 1, page_size: 20 }],
      [$pins, opts.pins ?? []],
      [$meta, { districts: ["chilonzor", "sergeli"], statuses: ["new", "active", "inactive"], source_kinds: ["olx", "telegram", "manual"], contact_classifications: ["owner", "agent", "unknown"] }],
    ],
  });
  await allSettled(sessionRestored, { scope, params: { id: "u1", phone: "+998900000001", name: "Aziz", role: "agent", locale: "uz" } });
  await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/properties"] }) });
  // $view is a `.map()`-derived store — fork's `values` only accepts writable stores, so map
  // view is reached the same way the app itself reaches it: firing the event.
  if (opts.view === "map") await allSettled(viewChanged, { scope, params: "map" });
  render(<Provider value={scope}><RouterProvider router={router}><PropertiesPage /></RouterProvider></Provider>);
  return scope;
}

describe("PropertiesPage", () => {
  beforeAll(() => i18nReady);

  it("renders the filters, the results count and the row", async () => {
    await mount();
    // district checkboxes come from /meta, not from a hardcoded list
    expect(screen.getByRole("checkbox", { name: "Chilonzor" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Sergeli" })).toBeInTheDocument();
    // shown both in the results header and on the rail's primary CTA (mirrors the mockup)
    expect(screen.getAllByText("42 ta uy")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /Chilonzor/ })).toBeInTheDocument();
    expect(screen.getByText("$450")).toBeInTheDocument();
    // 42 rows over a page size of 20 → 3 pages, so the pager is shown
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("renders the manual-add button", async () => {
    await mount();
    expect(screen.getByRole("button", { name: "Qo'lda qo'shish" })).toBeInTheDocument();
  });

  it("puts a district click into the URL instead of component state", async () => {
    const scope = await mount();
    await userEvent.click(screen.getByRole("checkbox", { name: "Sergeli" }));
    // the push to history is an effect, so give it a tick rather than assuming it is done
    await waitFor(() => expect(scope.getState(router.$query)).toEqual({ district: "sergeli" }));
    expect(screen.getByRole("checkbox", { name: "Sergeli" })).toBeChecked();
  });

  it("defaults to the list view, with a toggle to switch to the map", async () => {
    const scope = await mount();
    expect(scope.getState($view)).toBe("list");
    expect(screen.getByRole("button", { name: "Ro'yxat" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Xarita" })).toHaveAttribute("aria-pressed", "false");
    // list view renders the card grid, unchanged
    expect(screen.getByText("$450")).toBeInTheDocument();
  });

  it("switches to a full-width map (no card column) when Map is chosen", async () => {
    const scope = await mount();
    await userEvent.click(screen.getByRole("button", { name: "Xarita" }));
    await waitFor(() => expect(scope.getState($view)).toBe("map"));
    expect(screen.getByRole("button", { name: "Xarita" })).toHaveAttribute("aria-pressed", "true");
    // map mode shows only the map (with the filter rail alongside) — no property cards
    expect(screen.queryByRole("link", { name: /Chilonzor/ })).not.toBeInTheDocument();
    // PropertyMap's own chrome (not the lazily-loaded map itself) renders synchronously
    expect(screen.getByRole("switch", { name: "Bu hududda qidirish" })).toBeInTheDocument();
  });

  it("shows the map in map view regardless of the rows page (pins are unpaged)", async () => {
    // $rows (paginated) and $pins (unpaged) are decoupled: map mode renders only the map, so an
    // empty rows page never hides it.
    const pin: Pin = { id: "p1", latitude: 41.3, longitude: 69.2, price_usd_min_minor: 45000, rooms: 2, status: "active", source_removed: false };
    await mount({ view: "map", page: { items: [], total: 0, page: 1, page_size: 20 }, pins: [pin] });
    // PropertyMap's own chrome renders — the map is not hidden behind the empty-rows state
    expect(screen.getByRole("switch", { name: "Bu hududda qidirish" })).toBeInTheDocument();
    // map mode has no card column, so the plain empty-rows note is not shown
    expect(screen.queryByText("Hech narsa topilmadi")).not.toBeInTheDocument();
  });
});
