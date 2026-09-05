import { render, screen } from "@testing-library/react";
import type { PropertyDetail } from "@/entities/property";
import { i18nReady } from "@/shared/i18n";
import { PropertyHeader } from "./PropertyHeader";

// LocationCard lazy-loads the real MapView (MapLibre needs WebGL, absent in jsdom) — stub the
// whole shared/ui/map module so the lazy import resolves to a plain, recognizable placeholder.
vi.mock("@/shared/ui/map", () => ({
  MapView: () => <div>Mock Map</div>,
}));

const richListing = {
  id: "l1",
  source: { id: "s1", kind: "olx", name: "olx-tashkent" },
  external_id: "77",
  url: "https://www.olx.uz/d/x-ID77.html",
  title: "2-комн",
  description: "Yorug' va shinam kvartira, metro yaqinida.",
  price: { amount_minor: 45000, currency: "USD", usd_minor: 45000 },
  rooms: 2, area_sqm: 54, floor: 3, total_floors: 9, district: "chilonzor", address_text: null,
  posted_at: "2026-08-20T09:00:00Z", first_seen_at: "2026-08-12T09:00:00Z", last_seen_at: "2026-08-29T12:40:00Z",
  source_removed: false, owner_marker: true, agent_marker: false, parse_confidence: 0.9,
  photos: [{ position: 0, url: "/api/v1/photos/l1/0.jpg", width: 300, height: 200 }],
  contacts: [],
  attributes: { bathroom_type: "combined" },
  latitude: 41.311, longitude: 69.279, location_label: "Chilonzor, 19-kvartal", location_radius_m: 300, location_precise: false,
  building_type: "brick", is_furnished: true, renovation: "euro", year_built: 2015,
};

const richDetail = {
  id: "p1", status: "active", district: "chilonzor", rooms: 2, floor: 3, total_floors: 9, area_sqm: 54,
  price_usd_min_minor: 45000, source_removed: false, needs_recheck: false,
  first_seen_at: "2026-08-12T09:00:00Z", last_seen_at: "2026-08-29T12:40:00Z", listing_count: 1, source_kinds: ["olx"],
  probable_owner: null, photo_url: null, last_status_event: null,
  latitude: 41.311, longitude: 69.279, location_radius_m: 300, location_label: "Chilonzor, 19-kvartal",
  building_type: "brick", is_furnished: true, renovation: "euro", year_built: 2015,
  listings: [richListing],
  status_events: [], duplicates: [],
} as PropertyDetail;

// Same property, but every new rich-apartments field is missing (as a bare/legacy record would
// be) — the spec grid and location card must both disappear rather than render an empty shell.
const bareDetail = {
  ...richDetail,
  id: "p2",
  latitude: null, longitude: null, location_radius_m: null, location_label: null,
  building_type: null, is_furnished: null, renovation: null, year_built: null,
  rooms: null, floor: null, total_floors: null, area_sqm: null,
  listings: [{ ...richListing, description: "", attributes: {} }],
} as PropertyDetail;

describe("PropertyHeader", () => {
  beforeAll(() => i18nReady);

  it("shows the description, translated specs and an approximate-location map", async () => {
    render(<PropertyHeader detail={richDetail} />);
    expect(screen.getByText("Yorug' va shinam kvartira, metro yaqinida.")).toBeInTheDocument();
    // buildingTypeKey("brick") -> "buildingType.brick" -> uz catalogue
    expect(screen.getByText("G'ishtli")).toBeInTheDocument();
    expect(screen.getByText("Chilonzor, 19-kvartal")).toBeInTheDocument();
    // the lazy-loaded MapView resolves asynchronously behind a Suspense fallback
    expect(await screen.findByText("Mock Map")).toBeInTheDocument();
  });

  it("hides the spec grid and location card when every new field is empty", () => {
    render(<PropertyHeader detail={bareDetail} />);
    expect(screen.queryByText("G'ishtli")).not.toBeInTheDocument();
    expect(screen.queryByText(/Xususiyatlar/)).not.toBeInTheDocument(); // property.specs header
    expect(screen.queryByText(/Joylashuv/)).not.toBeInTheDocument(); // property.location header
    expect(screen.queryByText("Mock Map")).not.toBeInTheDocument();
  });
});
