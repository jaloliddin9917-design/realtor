import { render, screen } from "@testing-library/react";
import { RouterProvider } from "atomic-router-react";
import { fork } from "effector";
import { Provider } from "effector-react";
import type { PropertyRow } from "@/entities/property";
import { i18nReady } from "@/shared/i18n";
import { router } from "@/shared/router";
import { PropertyTable } from "./PropertyTable";

const row: PropertyRow = { id: "p1", status: "active", district: "chilonzor", rooms: 2, floor: 3, total_floors: 9, area_sqm: 54, price_usd_min_minor: 45000, source_removed: false, needs_recheck: false, first_seen_at: "2026-08-12T09:00:00Z", last_seen_at: "2026-08-29T12:40:00Z", listing_count: 2, source_kinds: ["olx", "telegram"], probable_owner: { contact_id: "c1", kind: "phone", identifier: "+998908112437", display_name: null, classification: "owner", agency_score: 0.1, confidence: 0.8 }, photo_url: null, last_status_event: { id: 1, from_status: "new", to_status: "active", actor_type: "agent", actor_id: "u1", note: null, created_at: "2026-08-29T12:40:00Z" }, latitude: null, longitude: null, location_radius_m: null, location_label: null, building_type: null, is_furnished: null, renovation: null, year_built: null };

describe("PropertyTable", () => {
  beforeAll(() => i18nReady);

  it("renders the mockup's columns from a row", () => {
    render(<Provider value={fork()}><RouterProvider router={router}><PropertyTable rows={[row]} /></RouterProvider></Provider>);
    expect(screen.getByText("Chilonzor")).toBeInTheDocument();
    expect(screen.getByText("2-xonali · 3/9 qavat · 54 m²")).toBeInTheDocument();
    expect(screen.getByText("$450")).toBeInTheDocument();
    expect(screen.getByText("Faol")).toBeInTheDocument();
    expect(screen.getByText("+998 90 811 24 37")).toBeInTheDocument();
    expect(screen.getByText("Egasi · 0.8")).toBeInTheDocument();
    expect(screen.getByText("OLX · Telegram")).toBeInTheDocument();
  });

  it("links each row to the property page", () => {
    render(<Provider value={fork()}><RouterProvider router={router}><PropertyTable rows={[row]} /></RouterProvider></Provider>);
    expect(screen.getByRole("link", { name: /Chilonzor/ })).toHaveAttribute("href", "/properties/p1");
  });

  it("shows the property thumbnail when a photo is present", () => {
    const withPhoto: PropertyRow = { ...row, id: "p9", photo_url: "/api/v1/photos/l9/0.jpg" };
    const { container } = render(<Provider value={fork()}><RouterProvider router={router}><PropertyTable rows={[withPhoto]} /></RouterProvider></Provider>);
    expect(container.querySelector('img[src="/api/v1/photos/l9/0.jpg"]')).not.toBeNull();
  });

});
