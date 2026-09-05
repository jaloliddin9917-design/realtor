import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "atomic-router-react";
import { allSettled, fork } from "effector";
import { Provider } from "effector-react";
import { createMemoryHistory } from "history";
import { $meta } from "@/entities/meta";
import { $page, type PropertyRow } from "@/entities/property";
import { sessionRestored } from "@/entities/session";
import { $hoveredId, $view } from "@/features/property/filters";
import { i18nReady } from "@/shared/i18n";
import { router } from "@/shared/router";
import { PropertiesPage } from "./ui";

// The map view mounts `PropertyMap`, which lazily loads `MapView` — maplibre-gl needs WebGL,
// which jsdom doesn't have, so it is mocked here too (trimmed copy of the mock in
// shared/ui/map/MapView.test.tsx and widgets/property-map/ui/PropertyMap.test.tsx). None of
// this file's assertions look at the map's internals, so the mock only needs to make mounting
// safe, not to track handlers/sources.
vi.mock("maplibre-gl", () => ({
  Map: vi.fn(function MockMap() {
    return {
      addControl: vi.fn(), on: vi.fn(), off: vi.fn(), remove: vi.fn(),
      getSource: vi.fn(), addSource: vi.fn(), removeSource: vi.fn(),
      getLayer: vi.fn(), addLayer: vi.fn(), removeLayer: vi.fn(),
      setFeatureState: vi.fn(), easeTo: vi.fn(),
      getBounds: vi.fn(() => ({ getSouth: () => 0, getWest: () => 0, getNorth: () => 0, getEast: () => 0 })),
      setCenter: vi.fn(), setZoom: vi.fn(), queryRenderedFeatures: vi.fn(),
    };
  }),
  NavigationControl: vi.fn(),
  Marker: vi.fn(function Marker() {
    const marker = { setLngLat: vi.fn(() => marker), addTo: vi.fn(() => marker), remove: vi.fn() };
    return marker;
  }),
}));

const row: PropertyRow = { id: "p1", status: "active", district: "chilonzor", rooms: 2, floor: 3, total_floors: 9, area_sqm: 54, price_usd_min_minor: 45000, source_removed: false, needs_recheck: false, first_seen_at: "2026-08-12T09:00:00Z", last_seen_at: "2026-08-29T12:40:00Z", listing_count: 2, source_kinds: ["olx", "telegram"], probable_owner: null, photo_url: null, last_status_event: null, latitude: null, longitude: null, location_radius_m: null, location_label: null, building_type: null, is_furnished: null, renovation: null, year_built: null };

async function mount() {
  const scope = fork({
    values: [
      [$page, { items: [row], total: 42, page: 1, page_size: 20 }],
      [$meta, { districts: ["chilonzor", "sergeli"], statuses: ["new", "active", "inactive"], source_kinds: ["olx", "telegram", "manual"], contact_classifications: ["owner", "agent", "unknown"] }],
    ],
  });
  await allSettled(sessionRestored, { scope, params: { id: "u1", phone: "+998900000001", name: "Aziz", role: "agent", locale: "uz" } });
  await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/properties"] }) });
  render(<Provider value={scope}><RouterProvider router={router}><PropertiesPage /></RouterProvider></Provider>);
  return scope;
}

describe("PropertiesPage", () => {
  beforeAll(() => i18nReady);

  it("renders the filters, the results count and both renderings of the rows", async () => {
    await mount();
    // district chips come from /meta, not from a hardcoded list
    expect(screen.getByRole("button", { name: "Chilonzor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sergeli" })).toBeInTheDocument();
    expect(screen.getByText("42 ta uy")).toBeInTheDocument();
    // the table (≥ lg) and the cards (< lg) both render; CSS picks one
    expect(screen.getAllByRole("link", { name: /Chilonzor/ })).toHaveLength(2);
    expect(screen.getByRole("columnheader", { name: "Narx" })).toBeInTheDocument();
    // 42 rows over a page size of 20 → 3 pages, so the pager is shown
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("renders the manual-add button", async () => {
    await mount();
    expect(screen.getByRole("button", { name: "Qo'lda qo'shish" })).toBeInTheDocument();
  });

  it("puts a chip click into the URL instead of component state", async () => {
    const scope = await mount();
    await userEvent.click(screen.getByRole("button", { name: "Sergeli" }));
    // the push to history is an effect, so give it a tick rather than assuming it is done
    await waitFor(() => expect(scope.getState(router.$query)).toEqual({ district: "sergeli" }));
    expect(screen.getByRole("button", { name: "Sergeli" })).toHaveAttribute("aria-pressed", "true");
  });

  it("defaults to the list view, with a toggle to switch to the map", async () => {
    const scope = await mount();
    expect(scope.getState($view)).toBe("list");
    expect(screen.getByRole("button", { name: "Ro'yxat" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Xarita" })).toHaveAttribute("aria-pressed", "false");
    // list view still renders both the table and the card renderings, unchanged
    expect(screen.getByRole("columnheader", { name: "Narx" })).toBeInTheDocument();
  });

  it("switches to a split cards+map layout when Map is chosen, hiding the table", async () => {
    const scope = await mount();
    await userEvent.click(screen.getByRole("button", { name: "Xarita" }));
    await waitFor(() => expect(scope.getState($view)).toBe("map"));
    expect(screen.getByRole("button", { name: "Xarita" })).toHaveAttribute("aria-pressed", "true");
    // the desktop table is gone; the cards (shared with the narrow list rendering) remain
    expect(screen.queryByRole("columnheader", { name: "Narx" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Chilonzor/ })).toBeInTheDocument();
    // PropertyMap's own chrome (not the lazily-loaded map itself) renders synchronously
    expect(screen.getByRole("switch", { name: "Bu hududda qidirish" })).toBeInTheDocument();
  });

  it("hovering a card in the map view sets $hoveredId, clearing it when the pointer leaves the panel", async () => {
    const scope = await mount();
    await userEvent.click(screen.getByRole("button", { name: "Xarita" }));
    const card = await screen.findByRole("link", { name: /Chilonzor/ });
    fireEvent.mouseOver(card);
    await waitFor(() => expect(scope.getState($hoveredId)).toBe("p1"));
    fireEvent.mouseOut(card, { relatedTarget: document.body });
    await waitFor(() => expect(scope.getState($hoveredId)).toBeNull());
  });
});
