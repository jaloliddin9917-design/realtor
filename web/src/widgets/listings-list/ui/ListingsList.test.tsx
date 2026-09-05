import { render, screen } from "@testing-library/react";
import type { PropertyDetail } from "@/entities/property";
import { i18nReady } from "@/shared/i18n";
import { ListingsList } from "./ListingsList";

const base = {
  id: "l1", source: { id: "s1", kind: "olx", name: "olx-tashkent" }, external_id: "77",
  url: "https://www.olx.uz/d/x-ID77.html", title: "2-комн", description: "",
  rooms: 2, area_sqm: 54, floor: 3, total_floors: 9, district: "chilonzor", address_text: null,
  posted_at: "2026-08-12T09:00:00Z", first_seen_at: "2026-08-12T09:00:00Z", last_seen_at: "2026-08-29T12:40:00Z",
  source_removed: false, owner_marker: false, agent_marker: false, parse_confidence: 0.9,
  photos: [], contacts: [], attributes: {},
  latitude: null, longitude: null, location_label: null, location_radius_m: null, location_precise: null,
  building_type: null, is_furnished: null, renovation: null, year_built: null,
};

describe("ListingsList", () => {
  beforeAll(() => i18nReady);

  it("shows a converted USD price, an owner/agent badge and the location label per listing", () => {
    const listings = [
      { ...base, id: "l1", price: { amount_minor: 15_000_000, currency: "UZS", usd_minor: 120_000 }, owner_marker: true, location_label: "Chilonzor, 19-kvartal" },
      { ...base, id: "l2", price: { amount_minor: 48000, currency: "USD", usd_minor: 48000 }, agent_marker: true },
    ] as PropertyDetail["listings"];
    render(<ListingsList listings={listings} duplicates={[]} />);
    // a non-USD listing gets a converted USD figure alongside its original-currency price
    expect(screen.getByText("≈ $1 200")).toBeInTheDocument();
    expect(screen.getByText("Chilonzor, 19-kvartal")).toBeInTheDocument();
    expect(screen.getByText("Egasi")).toBeInTheDocument();
    expect(screen.getByText("Rieltor")).toBeInTheDocument();
  });

  it("doesn't repeat the price when the listing is already in USD, and skips markers/label when unset", () => {
    const listings = [{ ...base, price: { amount_minor: 45000, currency: "USD", usd_minor: 45000 } }] as PropertyDetail["listings"];
    render(<ListingsList listings={listings} duplicates={[]} />);
    expect(screen.queryByText(/^≈/)).not.toBeInTheDocument();
    expect(screen.queryByText("Egasi")).not.toBeInTheDocument();
    expect(screen.queryByText("Rieltor")).not.toBeInTheDocument();
  });
});
